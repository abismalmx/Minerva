/**
 * Route dispatch for the self-hosted sync Worker.
 *
 * The native Minerva sync API — `/api/sync`, `/api/sync/replicas`,
 * `/api/sync/replica-keys`, `/api/storage/*`, `/api/auth/*` — is the only
 * surface. An unmodified Minerva build talks to it by pointing `API_BASE_URL`
 * at this Worker.
 *
 * Data lives in D1 (SQLite) and the book files in R2.
 */

import { errorJson, type Env } from './http';
import { extractBearerToken, verifyToken } from './auth';
import { handleSyncGet } from './pull';
import { handleSyncPost } from './push';
import { handleReplicaPost, handleReplicaPull } from './replicas';
import {
  handleReplicaKeysCreate,
  handleReplicaKeysForget,
  handleReplicaKeysList,
} from './replicaKeys';
import {
  handleStorageDelete,
  handleStorageDownload,
  handleStorageList,
  handleStorageObjectGet,
  handleStorageObjectPut,
  handleStoragePurge,
  handleStorageStats,
  handleStorageUpload,
} from './storage';
import {
  handleDeleteAccount,
  handleDeleteLibrary,
  handleLogin,
  handleMe,
  handleRegister,
  handleUpdateEmail,
} from './accounts';

/** Resolve the caller's account from the bearer token, or answer 401. */
export const requireUser = async (
  request: Request,
  env: Env,
): Promise<{ userId: string } | { response: Response }> => {
  if (!env.JWT_SECRET) {
    return { response: errorJson('Server is not configured: JWT_SECRET is missing', 503) };
  }
  const token = extractBearerToken(request.headers.get('authorization'));
  if (!token) return { response: errorJson('Not authenticated', 401) };
  const claims = await verifyToken(env.JWT_SECRET, token);
  if (!claims) return { response: errorJson('Not authenticated', 401) };
  // The token is self-contained: it carries the account id and expires on its
  // own, so a deleted account's token would keep working until it expired
  // (30 days). One indexed lookup ties the session to the account it was
  // issued for, so deleting the account really ends the session.
  const account = await env.SYNC_DB.prepare('SELECT id FROM users WHERE id = ?')
    .bind(claims.sub)
    .first<{ id: string }>();
  if (!account) return { response: errorJson('Not authenticated', 401) };
  return { userId: claims.sub };
};

/** The native Minerva API, mounted under `/api`. */
const handleApiRoute = async (request: Request, env: Env, path: string): Promise<Response> => {
  // --- unauthenticated routes ---
  if (path === '/auth/register' && request.method === 'POST') {
    return handleRegister(request, env);
  }
  if (path === '/auth/login' && request.method === 'POST') {
    return handleLogin(request, env);
  }

  // The object route carries its own credential: the client transfers the
  // bytes with a plain PUT / GET and no Authorization header, exactly as it
  // does against a presigned R2 URL. The ticket in the query string IS the
  // credential, so the route must be reached BEFORE the bearer-token check.
  if (path === '/storage/object') {
    if (request.method === 'PUT') return handleStorageObjectPut(request, env);
    if (request.method === 'GET') return handleStorageObjectGet(request, env);
  }

  // --- authenticated routes ---
  const auth = await requireUser(request, env);
  if ('response' in auth) return auth.response;
  const userId = auth.userId;

  if (path === '/auth/me' && request.method === 'GET') {
    return handleMe(env, userId);
  }
  if (path === '/auth/email' && request.method === 'POST') {
    return handleUpdateEmail(request, env, userId);
  }
  // Two routes for the same operation: `/user/delete` is what the Minerva
  // client calls, `/auth/account` is the name the spec gives it.
  if ((path === '/user/delete' || path === '/auth/account') && request.method === 'DELETE') {
    return handleDeleteAccount(env, userId);
  }
  if (path === '/user/library' && request.method === 'DELETE') {
    return handleDeleteLibrary(env, userId);
  }
  if (path === '/sync' && request.method === 'GET') {
    return handleSyncGet({ request, env, userId });
  }
  if (path === '/sync' && request.method === 'POST') {
    return handleSyncPost(request, env, userId);
  }
  if (path === '/sync/replicas' && request.method === 'GET') {
    return handleReplicaPull(request, env, userId);
  }
  if (path === '/sync/replicas' && request.method === 'POST') {
    return handleReplicaPost(request, env, userId);
  }
  if (path === '/sync/replica-keys') {
    if (request.method === 'GET') return handleReplicaKeysList(env, userId);
    if (request.method === 'POST') return handleReplicaKeysCreate(request, env, userId);
    if (request.method === 'DELETE') return handleReplicaKeysForget(env, userId);
  }
  if (path === '/storage/upload' && request.method === 'POST') {
    return handleStorageUpload(request, env, userId);
  }
  if (path === '/storage/download') {
    if (request.method === 'GET' || request.method === 'POST') {
      return handleStorageDownload(request, env, userId);
    }
  }
  if (path === '/storage/list' && request.method === 'GET') {
    return handleStorageList(request, env, userId);
  }
  if (path === '/storage/stats' && request.method === 'GET') {
    return handleStorageStats(env, userId);
  }
  if (path === '/storage/delete' && request.method === 'DELETE') {
    return handleStorageDelete(request, env, userId);
  }
  if (path === '/storage/purge' && request.method === 'DELETE') {
    return handleStoragePurge(request, env, userId);
  }
  return errorJson('Not Found', 404);
};

/** Dispatch one request to the right surface. */
export const routeRequest = async (request: Request, env: Env, path: string): Promise<Response> => {
  if (path.startsWith('/api/')) {
    return handleApiRoute(request, env, path.slice('/api'.length));
  }
  return errorJson('Not Found', 404);
};

/** The service description served at the root. */
export const SERVICE_INFO = {
  name: 'minerva-selfhost-sync',
  version: 2,
  endpoints: [
    '/api/sync',
    '/api/sync/replicas',
    '/api/sync/replica-keys',
    '/api/storage/upload',
    '/api/storage/download',
    '/api/storage/list',
    '/api/storage/delete',
    '/api/storage/purge',
    '/api/auth/register',
    '/api/auth/login',
    '/api/auth/me',
    '/api/auth/account',
    '/api/user/delete',
    '/api/user/library',
    '/users/create',
    '/users/auth',
    '/syncs/progress',
  ],
};
