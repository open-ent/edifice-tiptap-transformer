/*
 * Open ENT : supervision du service, lue par le dashboard
 * (/admin/configuration/openent?tab=content-transformer).
 *
 * - GET /health : identité, blocs connus du schéma, compteurs et durées par opération,
 *   codes de réponse de /transform et dernières erreurs. En mode cluster (NB_THREADS > 1),
 *   le worker qui reçoit la requête demande au processus principal de réunir les
 *   statistiques de tous les workers, sinon on ne verrait qu'une fraction du trafic.
 * - POST /diagnose : nettoie un HTML comme /transform et liste ce qui a été supprimé.
 *
 * Aucune donnée de contenu n'est conservée : les erreurs gardent le type, le code et la
 * taille de la requête, et un message tronqué avant tout extrait de document.
 */
import cluster from 'cluster';
import { readFileSync } from 'fs';
import path from 'path';
import { NextFunction, Request, Response } from 'express';
import { generateText } from '@tiptap/core';
import { generateHTML, generateJSON } from '@tiptap/html';
import {
  ADDITIONAL_EXTENSIONS,
  EXTENSIONS,
} from './transformation-controller.js';

const SAMPLES_PER_OPERATION = 500;
const MAX_RECENT_ERRORS = 20;
const COLLECT_TIMEOUT_MS = 2000;

interface OperationStats {
  count: number;
  totalMs: number;
  maxMs: number;
  samples: number[];
}

interface ErrorEntry {
  at: string;
  pid: number;
  status: number;
  kind: string;
  message: string;
  bytes: number;
}

export interface WorkerStats {
  pid: number;
  startedAt: string;
  rssBytes: number;
  heapUsedBytes: number;
  operations: Record<string, OperationStats>;
  responses: Record<string, number>;
  recentErrors: ErrorEntry[];
}

const startedAt = new Date().toISOString();
const operations: Record<string, OperationStats> = {};
const responses: Record<string, number> = {};
const recentErrors: ErrorEntry[] = [];

export function recordOperation(operation: string, elapsedMs: number) {
  const stats = (operations[operation] ??= {
    count: 0,
    totalMs: 0,
    maxMs: 0,
    samples: [],
  });
  stats.count++;
  stats.totalMs += elapsedMs;
  stats.maxMs = Math.max(stats.maxMs, elapsedMs);
  stats.samples.push(elapsedMs);
  if (stats.samples.length > SAMPLES_PER_OPERATION) stats.samples.shift();
}

// Les messages de ProseMirror citent parfois un extrait du document après « : ».
function safeMessage(message: unknown): string {
  return String(message ?? '')
    .split(':')[0]
    .slice(0, 120);
}

/** À placer avant express.json() pour compter aussi les corps refusés (413). */
export function trackTransformResponses(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (req.path !== '/transform') return next();
  res.on('finish', () => {
    const key = res.statusCode < 400 ? '2xx' : String(res.statusCode);
    responses[key] = (responses[key] ?? 0) + 1;
    if (res.statusCode >= 400) {
      recentErrors.unshift({
        at: new Date().toISOString(),
        pid: process.pid,
        status: res.statusCode,
        kind: res.locals.errorKind ?? `http.${res.statusCode}`,
        message: res.locals.errorMessage ?? '',
        bytes: Number(req.headers['content-length'] ?? 0),
      });
      recentErrors.length = Math.min(recentErrors.length, MAX_RECENT_ERRORS);
    }
  });
  next();
}

/** Gestionnaire d'erreur à placer APRÈS les routes : l'amont n'en a qu'un, avant elles. */
export function recordRouteError(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  err: any,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction,
) {
  res.locals.errorKind = err?.name ?? 'Error';
  res.locals.errorMessage = safeMessage(err?.message);
  console.warn(
    `msg="unhandled.error" path="${req.path}" kind="${res.locals.errorKind}" message="${res.locals.errorMessage}"`,
  );
  res.status(500).json({ error: 'internal.server.error' });
}

function localStats(): WorkerStats {
  const memory = process.memoryUsage();
  return {
    pid: process.pid,
    startedAt,
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    operations,
    responses,
    recentErrors,
  };
}

// ── Agrégation entre workers (IPC du module cluster) ────────────────────────────────

const REQUEST = 'openent-health-request';
const RESPONSE = 'openent-health-response';
const COLLECT = 'openent-health-collect';
const STATS = 'openent-health-stats';

type HealthMessage = {
  type?: string;
  id?: string;
  stats?: WorkerStats;
  workers?: WorkerStats[];
};

const pendingRequests = new Map<string, (workers: WorkerStats[]) => void>();

/** Côté worker : répond aux collectes du principal et reçoit les réponses agrégées. */
export function installWorkerHealthHandler() {
  if (!cluster.isWorker) return;
  process.on('message', (message: HealthMessage) => {
    if (message?.type === COLLECT && message.id) {
      process.send?.({ type: STATS, id: message.id, stats: localStats() });
    } else if (message?.type === RESPONSE && message.id) {
      pendingRequests.get(message.id)?.(message.workers ?? []);
      pendingRequests.delete(message.id);
    }
  });
}

/** Côté processus principal : réunit les statistiques de tous les workers vivants. */
export function installPrimaryHealthAggregator() {
  let sequence = 0;
  cluster.on('message', (requester, message: HealthMessage) => {
    if (message?.type !== REQUEST || !message.id) return;
    const workers = Object.values(cluster.workers ?? {}).filter(
      (w) => w && !w.isDead(),
    );
    const id = `${process.pid}-${++sequence}`;
    const collected: WorkerStats[] = [];
    const finish = () => {
      clearTimeout(timer);
      cluster.removeListener('message', onStats);
      if (!requester.isDead()) {
        requester.send({ type: RESPONSE, id: message.id, workers: collected });
      }
    };
    const onStats = (_worker: unknown, reply: HealthMessage) => {
      if (reply?.type !== STATS || reply.id !== id || !reply.stats) return;
      collected.push(reply.stats);
      if (collected.length >= workers.length) finish();
    };
    const timer = setTimeout(finish, COLLECT_TIMEOUT_MS - 500);
    cluster.on('message', onStats);
    workers.forEach((w) => w?.send({ type: COLLECT, id }));
  });
}

function collectStats(): Promise<{ workers: WorkerStats[]; partial: boolean }> {
  if (!cluster.isWorker || !process.send) {
    return Promise.resolve({ workers: [localStats()], partial: false });
  }
  const id = `${process.pid}-${Date.now()}-${Math.random()}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      resolve({ workers: [localStats()], partial: true });
    }, COLLECT_TIMEOUT_MS);
    pendingRequests.set(id, (workers) => {
      clearTimeout(timer);
      resolve({
        workers: workers.length ? workers : [localStats()],
        partial: !workers.length,
      });
    });
    process.send?.({ type: REQUEST, id });
  });
}

// ── /health ─────────────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function readPackage(): {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
} {
  try {
    return JSON.parse(
      readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    );
  } catch {
    return {};
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extensionNames(extensions: any[]): string[] {
  return extensions.map((e) => e?.name).filter(Boolean);
}

function selfTest(): { ok: boolean; message: string } {
  try {
    const json = generateJSON('<p>Open <strong>ENT</strong></p>', EXTENSIONS);
    const html = generateHTML(json, EXTENSIONS);
    const text = generateText(json, EXTENSIONS);
    const ok = html.includes('<strong>ENT</strong>') && text === 'Open ENT';
    return { ok, message: ok ? 'ok' : 'unexpected.output' };
  } catch (e) {
    return { ok: false, message: safeMessage((e as Error)?.message) };
  }
}

export async function healthController(res: Response, serviceVersion: number) {
  const { workers, partial } = await collectStats();
  const pkg = readPackage();

  const merged: Record<string, OperationStats> = {};
  const totals: Record<string, number> = {};
  for (const worker of workers) {
    for (const [name, stats] of Object.entries(worker.operations)) {
      const m = (merged[name] ??= { count: 0, totalMs: 0, maxMs: 0, samples: [] });
      m.count += stats.count;
      m.totalMs += stats.totalMs;
      m.maxMs = Math.max(m.maxMs, stats.maxMs);
      m.samples.push(...stats.samples);
    }
    for (const [status, count] of Object.entries(worker.responses)) {
      totals[status] = (totals[status] ?? 0) + count;
    }
  }
  const test = selfTest();

  res.json({
    status: test.ok ? 'ok' : 'degraded',
    service: {
      name: pkg.name,
      version: pkg.version,
      upstream: 'edificeio/edifice-tiptap-transformer',
      contentVersion: serviceVersion,
    },
    versions: {
      node: process.versions.node,
      tiptapExtensions: pkg.dependencies?.['@open-ent/tiptap-extensions'],
      tiptapCore: pkg.dependencies?.['@tiptap/core'],
    },
    uptimeSeconds: Math.round(process.uptime()),
    workers: workers.map((w) => ({
      pid: w.pid,
      startedAt: w.startedAt,
      rssBytes: w.rssBytes,
      heapUsedBytes: w.heapUsedBytes,
    })),
    partial,
    selfTest: test,
    schema: {
      extensions: extensionNames(EXTENSIONS),
      additional: Object.fromEntries(
        [...ADDITIONAL_EXTENSIONS.entries()].map(([id, ext]) => [
          id,
          extensionNames(Array.isArray(ext) ? ext : [ext]),
        ]),
      ),
    },
    operations: Object.fromEntries(
      Object.entries(merged).map(([name, m]) => {
        const sorted = [...m.samples].sort((a, b) => a - b);
        return [
          name,
          {
            count: m.count,
            avgMs: m.count ? Math.round((m.totalMs / m.count) * 10) / 10 : 0,
            p95Ms: percentile(sorted, 95),
            maxMs: m.maxMs,
          },
        ];
      }),
    ),
    responses: totals,
    recentErrors: workers
      .flatMap((w) => w.recentErrors)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, MAX_RECENT_ERRORS),
  });
}

// ── /diagnose ───────────────────────────────────────────────────────────────────────

function inventory(html: string): Map<string, number> {
  const counts = new Map<string, number>();
  const doc = new DOMParser().parseFromString(
    `<body>${html}</body>`,
    'text/html',
  );
  doc.body.querySelectorAll('*').forEach((el) => {
    const tag = el.tagName.toLowerCase();
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
    for (const attr of Array.from(el.attributes)) {
      const key = `${tag}[${attr.name}]`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  });
  return counts;
}

export function diagnoseController(req: Request, res: Response) {
  const html = req.body?.html;
  if (typeof html !== 'string' || !html.trim()) {
    res.status(400).json({ error: 'no.html' });
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let extensions: any[] = [...EXTENSIONS];
  for (const id of req.body?.additionalExtensionIds ?? []) {
    const ext = ADDITIONAL_EXTENSIONS.get(id);
    if (ext) extensions = extensions.concat(ext);
  }
  const start = Date.now();
  const cleanHtml = generateHTML(generateJSON(html, extensions), extensions);
  const elapsedMs = Date.now() - start;

  const before = inventory(html);
  const after = inventory(cleanHtml);
  const removed: { element: string; count: number }[] = [];
  for (const [key, count] of before) {
    const lost = count - (after.get(key) ?? 0);
    if (lost > 0) removed.push({ element: key, count: lost });
  }
  // Ce que le schéma ajoute ou renomme (<b> → <strong>, image enveloppée dans un <p>…).
  const added: { element: string; count: number }[] = [];
  for (const [key, count] of after) {
    const gained = count - (before.get(key) ?? 0);
    if (gained > 0) added.push({ element: key, count: gained });
  }
  res.json({ cleanHtml, elapsedMs, removed, added });
}
