import express, { Express, NextFunction, Request, Response } from 'express';
import 'global-jsdom/register';
import {
  healthCheck,
  transformController,
} from './controllers/transformation-controller.js';
import { initMetrics } from './controllers/metrics-controller.js';
import {
  diagnoseController,
  healthController,
  installWorkerHealthHandler,
  recordRouteError,
  trackTransformResponses,
} from './controllers/health-controller.js';

// @ts-ignore
global.CSS = {
  // @ts-ignore
  escape: (elt) => elt, // @ts-ignore
};
export default function createServer() {
  console.log(`msg="Launching instance of the transformer"`);

  const app: Express = express();
  const port = process.env.PORT || 3000;
  const serviceVersion = 1;

  initMetrics(app);
  installWorkerHealthHandler();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expressOptions: any = {};
  if (process.env.MAX_BODY_SIZE) {
    expressOptions['limit'] = process.env.MAX_BODY_SIZE;
  }

  app.use(trackTransformResponses);
  app.use(express.json(expressOptions));
  app.use(
    (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      err: any,
      req: Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      next: express.NextFunction,
    ) => {
      res.locals.errorKind = err.type ?? 'unhandled.error';
      if (err.status === 413 || err.type === 'entity.too.large') {
        console.warn(`msg="payload.too.large"`);
        res.status(413).send('payload.too.large');
      } else {
        console.warn(
          `msg="unhandled.error" type="${err.type}" status="${err.status}" stack="${stringifyStackTrace(err.stack)}"`,
        );
        res.status(500).json({ error: 'internal.server.error' });
      }
    },
  );

  app.get('/', (req: Request, res: Response) => {
    res.send('Hello World!');
  });

  app.post('/transform', (req: Request, res: Response) => {
    transformController(req, res, serviceVersion);
  });
  app.get('/healthcheck', (req: Request, res: Response) => {
    healthCheck(res);
  });
  app.get('/health', (req: Request, res: Response, next: NextFunction) => {
    healthController(res, serviceVersion).catch(next);
  });
  app.post('/diagnose', diagnoseController);
  app.use(recordRouteError);

  app.listen(port, () => {
    console.log(`msg="Example app listening on port ${port}"`);
  });
}
function stringifyStackTrace(stack: string) {
  let stringified;
  if (stack) {
    stringified = stack.replace(/"/g, '"').replace(/\n/g, '\\\\n');
  } else {
    stringified = '';
  }
  return stringified;
}
