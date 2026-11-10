/**
 * Self-hosted Minerva sync backend — Cloudflare Worker entry point.
 *
 * The routing lives in `routes.ts`; this file is the Worker shell: CORS, the
 * preflight, the health probe and the error boundary.
 */

import { errorJson, json, preflight, withCors, type Env } from './http';
import { routeRequest, SERVICE_INFO } from './routes';
import type { ExportedHandler } from './types';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return preflight(request, env);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      let response: Response;
      if (path === '/health') {
        response = json({ status: 'ok' });
      } else if (path === '/' || path === '/api') {
        response = json(SERVICE_INFO);
      } else {
        response = await routeRequest(request, env, path);
      }
      return withCors(request, env, response);
    } catch (error) {
      console.error('unhandled error', error);
      return withCors(request, env, errorJson('Internal Server Error', 500));
    }
  },
} satisfies ExportedHandler<Env>;
