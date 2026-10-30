/**
 * @vitest-environment node
 *
 * The doubles read the migrations from disk and run them on a real SQLite
 * database, so this suite needs the Node environment rather than jsdom.
 */
import { describe, it, expect } from 'vitest';

// Storage lifecycle tests for the self-hosted sync Worker.
//
// They run against a REAL SQLite schema (the Worker's own migrations) and a
// double that consumes the body stream, because the storage routes are
// exactly where the schema and the byte accounting matter:
//
// - the `files.file_key` UNIQUE index decides whether a re-upload works,
// - the soft-delete flag decides whether a deleted book can come back,
// - `SUM(file_size)` decides whether the quota is real or decorative.

import {
  handleStorageDelete,
  handleStorageDownload,
  handleStorageList,
  handleStorageObjectGet,
  handleStorageObjectPut,
  handleStoragePurge,
  handleStorageStats,
  handleStorageUpload,
} from '../../../workers/minerva-sync/src/storage';
import { mintTicket } from '../../../workers/minerva-sync/src/storageTicket';
import { MemoryR2, SqliteD1, TEST_SECRET } from './minerva-sync-doubles';

const USER_ID = '11111111-2222-3333-4444-555555555555';

const req = (url: string, init: RequestInit = {}) =>
  new Request(url.startsWith('http') ? url : `https://worker.test${url}`, init);

const jsonBody = (obj: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj),
});

interface TestEnv {
  JWT_SECRET: string;
  ALLOWED_ORIGINS: string;
  MAX_UPLOAD_BYTES: string;
  STORAGE_FIXED_QUOTA: string;
  SYNC_DB: SqliteD1;
  LIBRARY_BUCKET: MemoryR2;
}

const makeEnv = (overrides: Partial<TestEnv> = {}): TestEnv => ({
  JWT_SECRET: TEST_SECRET,
  ALLOWED_ORIGINS: '*',
  MAX_UPLOAD_BYTES: '104857600',
  STORAGE_FIXED_QUOTA: '0',
  SYNC_DB: SqliteD1.withMigrations(),
  LIBRARY_BUCKET: new MemoryR2(),
  ...overrides,
});

/** Reserve a slot and return the URL the client is meant to PUT to. */
const reserve = async (env: TestEnv, fileName: string, fileSize: number) => {
  const response = await handleStorageUpload(
    req('/api/storage/upload', jsonBody({ fileName, fileSize })),
    env as never,
    USER_ID,
  );
  const body = (await response.json()) as {
    uploadUrl?: string;
    downloadUrl?: string;
    fileKey?: string;
  };
  const url = body.uploadUrl ? new URL(body.uploadUrl) : null;
  return {
    response,
    body,
    fileKey: body.fileKey ?? '',
    key: url?.searchParams.get('key') ?? '',
    ticket: url?.searchParams.get('ticket') ?? '',
  };
};

/** PUT a body at the object route. */
const putObject = (env: TestEnv, key: string, ticket: string, body: string) =>
  handleStorageObjectPut(
    req(`/api/storage/object?key=${encodeURIComponent(key)}&ticket=${encodeURIComponent(ticket)}`, {
      method: 'PUT',
      body,
    }),
    env as never,
  );

describe('el ciclo de vida del almacenamiento en R2', () => {
  it('reserva, escribe y devuelve los bytes', async () => {
    const env = makeEnv();
    const { response, fileKey, key, ticket } = await reserve(env, 'book.epub', 5);
    expect(response.status).toBe(200);
    expect(fileKey).toBe(`${USER_ID}/book.epub`);

    const put = await putObject(env, key, ticket, 'hello');
    expect(put.status).toBe(200);

    const stored = env.LIBRARY_BUCKET.objects.get(key);
    expect(stored?.body).toBeDefined();
    expect(new TextDecoder().decode(stored!.body)).toBe('hello');

    // The download URL streams the same bytes back.
    const download = await handleStorageDownload(
      req(`/api/storage/download?fileKey=${encodeURIComponent(fileKey)}`),
      env as never,
      USER_ID,
    );
    expect(download.status).toBe(200);
    const { downloadUrl } = (await download.json()) as { downloadUrl: string };
    const get = await handleStorageObjectGet(
      req(`${new URL(downloadUrl).pathname}${new URL(downloadUrl).search}`),
      env as never,
    );
    expect(get.status).toBe(200);
    expect(await get.text()).toBe('hello');
  });

  it('recorta el cuerpo real aunque el Content-Length mienta', async () => {
    const env = makeEnv({ MAX_UPLOAD_BYTES: '1024' });
    // The reservation sits on the global limit: the limit that has to hold is
    // the global one, not the size the client declared.
    const { key, ticket } = await reserve(env, 'orphan.epub', 1024);

    const put = await putObject(env, key, ticket, 'x'.repeat(4096));
    expect(put.status).toBe(413);
    // Nothing was committed.
    expect(env.LIBRARY_BUCKET.objects.has(key)).toBe(false);
  });

  it('rechaza un cuerpo mayor que la reserva (la cuota no se puede esquivar)', async () => {
    const env = makeEnv({ MAX_UPLOAD_BYTES: '104857600' });
    const { key, ticket } = await reserve(env, 'book.epub', 10);

    const put = await putObject(env, key, ticket, 'x'.repeat(4096));
    expect(put.status).toBe(413);
    expect(env.LIBRARY_BUCKET.objects.has(key)).toBe(false);
  });

  it('acepta un cuerpo dentro de la reserva', async () => {
    const env = makeEnv();
    const { key, ticket } = await reserve(env, 'book.epub', 10);
    const put = await putObject(env, key, ticket, 'x'.repeat(10));
    expect(put.status).toBe(200);
    expect(env.LIBRARY_BUCKET.objects.get(key)?.body.length).toBe(10);
  });

  it('no acepta el ticket de otra clave', async () => {
    const env = makeEnv();
    const { ticket } = await reserve(env, 'book.epub', 10);
    const otherKey = `${USER_ID}/other.epub`;

    const put = await putObject(env, otherKey, ticket, 'x'.repeat(10));
    expect(put.status).toBe(403);
    expect(env.LIBRARY_BUCKET.objects.has(otherKey)).toBe(false);
  });

  it('no acepta una escritura sin ticket', async () => {
    const env = makeEnv();
    const { key } = await reserve(env, 'book.epub', 10);
    const put = await putObject(env, key, '', 'x'.repeat(10));
    expect(put.status).toBe(403);
  });

  it('responde 404 por un objeto que no existe', async () => {
    const env = makeEnv();
    const key = `${USER_ID}/missing.epub`;
    const ticket = (await mintTicket(TEST_SECRET, key)) ?? '';
    const get = await handleStorageObjectGet(
      req(
        `/api/storage/object?key=${encodeURIComponent(key)}&ticket=${encodeURIComponent(ticket)}`,
      ),
      env as never,
    );
    expect(get.status).toBe(404);
  });

  it('el borrado quita el objeto y lo saca de la lista', async () => {
    const env = makeEnv();
    const { key, ticket } = await reserve(env, 'book.epub', 5);
    await putObject(env, key, ticket, 'hello');

    const deleted = await handleStorageDelete(
      req('/api/storage/delete', jsonBody({ fileKey: key })),
      env as never,
      USER_ID,
    );
    expect(deleted.status).toBe(200);
    expect(env.LIBRARY_BUCKET.objects.has(key)).toBe(false);

    const list = await handleStorageList(req('/api/storage/list'), env as never, USER_ID);
    const listed = (await list.json()) as { files: unknown[]; total: number };
    expect(listed.total).toBe(0);
    expect(listed.files).toHaveLength(0);

    // The row is soft-deleted, so the download URL is refused.
    const download = await handleStorageDownload(
      req(`/api/storage/download?fileKey=${encodeURIComponent(key)}`),
      env as never,
      USER_ID,
    );
    expect(download.status).toBe(404);
  });

  it('re-subir una clave borrada revive la fila en vez de chocar con el índice UNIQUE', async () => {
    const env = makeEnv();
    const { key, ticket } = await reserve(env, 'book.epub', 5);
    await putObject(env, key, ticket, 'hello');
    await handleStorageDelete(
      req('/api/storage/delete', jsonBody({ fileKey: key })),
      env as never,
      USER_ID,
    );

    // The soft-deleted row still owns `files.file_key`: the reservation has to
    // revive it instead of inserting a second row for the same key.
    const again = await reserve(env, 'book.epub', 7);
    expect(again.response.status).toBe(200);
    const put = await putObject(env, again.key, again.ticket, 'hello!');
    expect(put.status).toBe(200);
    expect(new TextDecoder().decode(env.LIBRARY_BUCKET.objects.get(again.key)!.body)).toBe(
      'hello!',
    );

    const row = await env.SYNC_DB.prepare(
      'SELECT file_size, deleted_at FROM files WHERE file_key = ?',
    )
      .bind(key)
      .first<{ file_size: number; deleted_at: string | null }>();
    expect(row?.deleted_at).toBeNull();
    // The quota is charged on the bytes actually stored (6), not on the size
    // the client declared when it reserved the slot (7).
    expect(row?.file_size).toBe(6);
  });

  it('la cuota del operador se aplica al reservar', async () => {
    const env = makeEnv({ STORAGE_FIXED_QUOTA: '1000' });
    const first = await reserve(env, 'a.epub', 900);
    expect(first.response.status).toBe(200);

    const second = await reserve(env, 'b.epub', 900);
    expect(second.response.status).toBe(507);
  });

  it('un cuerpo menor que la reserva devuelve la cuota', async () => {
    const env = makeEnv({ STORAGE_FIXED_QUOTA: '1000' });
    const { key, ticket } = await reserve(env, 'a.epub', 900);
    const put = await putObject(env, key, ticket, 'x'.repeat(100));
    expect(put.status).toBe(200);

    // Only the bytes actually stored are charged, so there is room again.
    const stats = await handleStorageStats(env as never, USER_ID);
    const usage = (await stats.json()) as { totalSize: number; quota: number };
    expect(usage.totalSize).toBe(100);
    expect(usage.quota).toBe(1000);

    const second = await reserve(env, 'b.epub', 900);
    expect(second.response.status).toBe(200);
  });

  it('las estadísticas reflejan los bytes almacenados', async () => {
    const env = makeEnv();
    const { key, ticket } = await reserve(env, 'a.epub', 5);
    await putObject(env, key, ticket, 'hello');

    const stats = await handleStorageStats(env as never, USER_ID);
    const body = (await stats.json()) as {
      totalFiles: number;
      totalSize: number;
      byBookHash: { bookHash: string | null; totalSize: number }[];
    };
    expect(body.totalFiles).toBe(1);
    expect(body.totalSize).toBe(5);
    expect(body.byBookHash[0]?.totalSize).toBe(5);
  });

  it('un usuario no puede leer ni escribir en el espacio de otro', async () => {
    const env = makeEnv();
    const { key, ticket } = await reserve(env, 'book.epub', 5);
    await putObject(env, key, ticket, 'hello');

    const otherDownload = await handleStorageDownload(
      req(`/api/storage/download?fileKey=${encodeURIComponent(key)}`),
      env as never,
      'someone-else',
    );
    expect(otherDownload.status).toBe(403);

    const otherDelete = await handleStorageDelete(
      req('/api/storage/delete', jsonBody({ fileKey: key })),
      env as never,
      'someone-else',
    );
    expect(otherDelete.status).toBe(200);
    // The other user's delete did not touch the object.
    expect(env.LIBRARY_BUCKET.objects.has(key)).toBe(true);
  });
});

describe('el contrato de almacenamiento que el cliente espera', () => {
  it('el borrado acepta la clave en la query string', async () => {
    const env = makeEnv();
    const { key, ticket } = await reserve(env, 'book.epub', 5);
    await putObject(env, key, ticket, 'hello');

    // The client sends `DELETE /api/storage/delete?fileKey=…` with NO body.
    // A route that only read the body answered 400 and the book file was
    // never removed from R2.
    const response = await handleStorageDelete(
      req(`/api/storage/delete?fileKey=${encodeURIComponent(key)}`, { method: 'DELETE' }),
      env as never,
      USER_ID,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { deleted: number };
    expect(body.deleted).toBe(1);
    expect(env.LIBRARY_BUCKET.objects.has(key)).toBe(false);
  });

  it('la subida devuelve tambien la URL de descarga', async () => {
    const env = makeEnv();
    const { body, key, ticket } = await reserve(env, 'cover.png', 5);
    // The client reads `downloadUrl` for the temp/media uploads (book
    // covers): it hands that URL to a third party, so it has to work
    // without the bearer token.
    expect(body.downloadUrl).toBeTruthy();
    // The two URLs are different capabilities: the download URL opens the
    // object, the upload URL replaces it. A URL that travels to a third
    // party must not be able to write.
    expect(body.downloadUrl).not.toBe(body.uploadUrl);
    expect(new URL(body.downloadUrl!).searchParams.get('key')).toBe(key);

    // The download URL reads without the bearer token.
    await putObject(env, key, ticket, 'hello');
    const downloadTicket = new URL(body.downloadUrl!).searchParams.get('ticket') ?? '';
    const get = await handleStorageObjectGet(
      req(
        `/api/storage/object?key=${encodeURIComponent(key)}&ticket=${encodeURIComponent(downloadTicket)}`,
      ),
      env as never,
    );
    expect(get.status).toBe(200);
    expect(await get.text()).toBe('hello');

    // And it cannot write.
    const put = await putObject(env, key, downloadTicket, 'EVIL');
    expect(put.status).toBe(403);
    expect(ticket).toBeTruthy();
  });

  it('la purga borra en bloque y detalla lo que no pudo borrar', async () => {
    const env = makeEnv();
    const first = await reserve(env, 'a.epub', 5);
    const second = await reserve(env, 'b.epub', 5);
    await putObject(env, first.key, first.ticket, 'hello');
    await putObject(env, second.key, second.ticket, 'world');

    const response = await handleStoragePurge(
      req('/api/storage/purge', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileKeys: [first.key, second.key, `${USER_ID}/missing.epub`] }),
      }),
      env as never,
      USER_ID,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: string[];
      failed: { fileKey: string; error: string }[];
      deletedCount: number;
      failedCount: number;
    };
    expect(body.deletedCount).toBe(2);
    expect(body.failedCount).toBe(1);
    expect(body.success.sort()).toEqual([first.key, second.key].sort());
    expect(body.failed[0]!.fileKey).toBe(`${USER_ID}/missing.epub`);
    expect(env.LIBRARY_BUCKET.objects.has(first.key)).toBe(false);
    expect(env.LIBRARY_BUCKET.objects.has(second.key)).toBe(false);
  });

  it('la purga no toca los archivos de otra cuenta', async () => {
    const env = makeEnv();
    const { key, ticket } = await reserve(env, 'book.epub', 5);
    await putObject(env, key, ticket, 'hello');

    const response = await handleStoragePurge(
      req('/api/storage/purge', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileKeys: [key] }),
      }),
      env as never,
      'someone-else',
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: string[]; failedCount: number };
    expect(body.success).toEqual([]);
    expect(body.failedCount).toBe(1);
    expect(env.LIBRARY_BUCKET.objects.has(key)).toBe(true);
  });

  it('la purga rechaza un conjunto vacio o demasiado grande', async () => {
    const env = makeEnv();
    const empty = await handleStoragePurge(
      req('/api/storage/purge', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileKeys: [] }),
      }),
      env as never,
      USER_ID,
    );
    expect(empty.status).toBe(400);

    const tooMany = await handleStoragePurge(
      req('/api/storage/purge', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fileKeys: Array.from({ length: 101 }, (_, i) => `${USER_ID}/f${i}`),
        }),
      }),
      env as never,
      USER_ID,
    );
    expect(tooMany.status).toBe(400);
  });
});
