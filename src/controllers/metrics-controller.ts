import prom from 'prom-client';
import { Express, Request, Response } from 'express';
import { recordOperation } from './health-controller.js';

export const h2jCounter = new prom.Counter({
  name: 'html_2_json_total',
  help: 'The number of transformations from HTML to JSON',
});
export const j2hCounter = new prom.Counter({
  name: 'json_2_html_total',
  help: 'The number of transformations from JSON to HTML',
});
export const h2plainTextCounter = new prom.Counter({
  name: 'html_2_plain_text_total',
  help: 'The number of transformations from HTML to PLAIN TEXT',
});
export const j2plainTextCounter = new prom.Counter({
  name: 'json_2_plain_text_total',
  help: 'The number of transformations from JSON to PLAIN TEXT',
});
export const cleanHtmlCounter = new prom.Counter({
  name: 'clean_html_total',
  help: 'The number of transformations to clean HTML',
});
export const cleanJsonCounter = new prom.Counter({
  name: 'clean_json_total',
  help: 'The number of transformations to clean JSON',
});
export const h2jTimer = new prom.Histogram({
  name: 'html_2_json_time',
  help: 'HTML to JSON transformation time',
});
export const j2hTimer = new prom.Histogram({
  name: 'json_2_html_time',
  help: 'JSON to HTML transformation time',
});
export const j2plainTextTimer = new prom.Histogram({
  name: 'json_2_plain_text_time',
  help: 'JSON to PLAIN TEXT transformation time',
});
export const h2plainTextTimer = new prom.Histogram({
  name: 'html_2_plain_text_time',
  help: 'HTML to PLAIN TEXT transformation time',
});
export const cleanHtmlTimer = new prom.Histogram({
  name: 'clean_html_time',
  help: 'HTML cleaning time',
});
export const cleanJsonTimer = new prom.Histogram({
  name: 'clean_json_time',
  help: 'JSON cleaning time',
});

export function initMetrics(app: Express) {
  const collectDefaultMetrics = prom.collectDefaultMetrics;
  collectDefaultMetrics({ prefix: 'transform' });
  app.get('/metrics', (req: Request, res: Response) => {
    res.set('Content-Type', prom.register.contentType);
    prom.register.metrics().then((data) => {
      res.end(data);
    });
  });
}

export function updateCounterAndTimer(
  start: number,
  counter: prom.Counter,
  timer: prom.Histogram,
) {
  const elapsed = Date.now() - start;
  counter.inc();
  timer.observe(elapsed);
  // Open ENT : même mesure, lisible par /health (les histogrammes prom-client gardent
  // leurs seuils par défaut, en secondes, alors qu'on observe des millisecondes).
  recordOperation(
    (counter as unknown as { name: string }).name.replace(/_total$/, ''),
    elapsed,
  );
}
