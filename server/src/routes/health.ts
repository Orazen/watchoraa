import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_request, response) => {
  response.json({ ok: true, service: 'blindnav-server', timestamp: new Date().toISOString() });
});

healthRouter.get('/healthz', (_request, response) => {
  response.json({ ok: true, service: 'blindnav-server', timestamp: new Date().toISOString() });
});
