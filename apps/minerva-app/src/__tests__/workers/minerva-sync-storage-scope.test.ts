/**
 * @vitest-environment node
 *
 * The scope of a storage ticket, and the reservation a write needs.
 *
 * Two invariants that the storage routes have to hold at the same time:
 *
 * - A ticket that travels to a third party (the download URL of a book cover
 *   goes to Discord, to an `<img>` tag) must only open the object. If the
 *   read URL could also write, anybody who saw the cover URL could replace
 *   the file behind it.
 * - A write is paid for by a reservation. When the reservation is gone (the
 *   user deleted the file), the ticket that outlives it must not write: the
 *   bytes would land in the bucket outside the account's quota.
 *
 * The doubles run the real migrations on an in-memory SQLite, so the soft
 * delete and the quota arithmetic are the deployed ones.
 */
import { describe, it, expect } from 'vitest';

import {
  handleStorageDelete,
  handleStorageObjectGet,
  handleStorageObjectPut,
  handleStorageStats,
  handleStorageUpload,
} from '../../../workers/minerva-sync/src/storage';
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

/** Reserve a slot and return both URLs the server hands to the client. */
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
  const upload = body.uploadUrl ? new URL(body.uploadUrl) : null;
  const download = body.downloadUrl ? new URL(body.downloadUrl) : null;
  return {
    response,
    body,
    fileKey: body.fileKey ?? '',
    key: upload?.searchParams.get('key') ?? '',
    writeTicket: upload?.searchParams.get('ticket') ?? '',
    readTicket: download?.searchParams.get('ticket') ?? '',
  };
};

const putObject = (env: TestEnv, key: string, ticket: string, body: string) =>
  handleStorageObjectPut(
    req(`/api/storage/object?key=${encodeURIComponent(key)}&ticket=${encodeURIComponent(ticket)}`, {
      method: 'PUT',
      body,
    }),
    env as never,
  );

const getObject = (env: TestEnv, key: string, ticket: string) =>
  handleStorageObjectGet(
    req(`/api/storage/object?key=${encodeURIComponent(key)}&ticket=${encodeURIComponent(ticket)}`),
    env as never,
  );

describe('el ámbito del ticket de almacenamiento', () => {
  it('la URL de descarga no puede escribir el objeto', async () => {
    const env = makeEnv();
    const { key, writeTicket, readTicket } = await reserve(env, 'cover.png', 5);

    // The upload URL writes.
    const put = await putObject(env, key, writeTicket, 'hello');
    expect(put.status).toBe(200);
    expect(new TextDecoder().decode(env.LIBRARY_BUCKET.objects.get(key)!.body)).toBe('hello');

    // The download URL — the one the client hands to Discord, to an <img>
    // tag — opens the object and nothing else.
    const get = await getObject(env, key, readTicket);
    expect(get.status).toBe(200);
    expect(await get.text()).toBe('hello');

    const overwrite = await putObject(env, key, readTicket, 'EVIL');
    expect(overwrite.status).toBe(403);
    // The object is untouched.
    expect(new TextDecoder().decode(env.LIBRARY_BUCKET.objects.get(key)!.body)).toBe('hello');
  });

  it('la URL de subida no puede leer el objeto', async () => {
    const env = makeEnv();
    const { key, writeTicket } = await reserve(env, 'book.epub', 5);
    await putObject(env, key, writeTicket, 'hello');

    const get = await getObject(env, key, writeTicket);
    expect(get.status).toBe(403);
  });

  it('las dos URLs del servidor son distintas', async () => {
    const env = makeEnv();
    const { body } = await reserve(env, 'cover.png', 5);
    expect(body.uploadUrl).toBeTruthy();
    expect(body.downloadUrl).toBeTruthy();
    // Same object, different capability: the write ticket is not the read one.
    expect(body.downloadUrl).not.toBe(body.uploadUrl);
    expect(new URL(body.downloadUrl!).searchParams.get('key')).toBe(
      new URL(body.uploadUrl!).searchParams.get('key'),
    );
  });
});

describe('una escritura necesita una reserva viva', () => {
  it('el ticket no escribe después de borrar el archivo', async () => {
    const env = makeEnv();
    const { key, writeTicket } = await reserve(env, 'book.epub', 5);
    await putObject(env, key, writeTicket, 'hello');

    const deleted = await handleStorageDelete(
      req('/api/storage/delete', jsonBody({ fileKey: key })),
      env as never,
      USER_ID,
    );
    expect(deleted.status).toBe(200);

    // The ticket is still valid for 30 minutes, but the reservation is gone:
    // the write has to be refused instead of falling back to the global
    // maximum, which would put the bytes in the bucket outside the quota.
    const put = await putObject(env, key, writeTicket, 'x'.repeat(64 * 1024));
    expect(put.status).toBe(403);
    expect(env.LIBRARY_BUCKET.objects.has(key)).toBe(false);
  });

  it('la cuota del operador no se evade borrando la reserva', async () => {
    const env = makeEnv({ STORAGE_FIXED_QUOTA: '1024' });
    const { key, writeTicket } = await reserve(env, 'book.epub', 5);
    await putObject(env, key, writeTicket, 'hello');
    await handleStorageDelete(
      req('/api/storage/delete', jsonBody({ fileKey: key })),
      env as never,
      USER_ID,
    );

    const put = await putObject(env, key, writeTicket, 'x'.repeat(64 * 1024));
    expect(put.status).toBe(403);
    expect(env.LIBRARY_BUCKET.objects.has(key)).toBe(false);

    // The bytes that were never written are not charged either.
    const stats = await handleStorageStats(env as never, USER_ID);
    const usage = (await stats.json()) as { totalSize: number; quota: number };
    expect(usage.totalSize).toBe(0);
    expect(usage.quota).toBe(1024);

    // And the quota is still whole: a new upload of 1 KiB fits.
    const again = await reserve(env, 'other.epub', 1024);
    expect(again.response.status).toBe(200);
  });

  it('re-subir el archivo borrado revive la reserva', async () => {
    const env = makeEnv();
    const { key, writeTicket } = await reserve(env, 'book.epub', 5);
    await putObject(env, key, writeTicket, 'hello');
    await handleStorageDelete(
      req('/api/storage/delete', jsonBody({ fileKey: key })),
      env as never,
      USER_ID,
    );

    // The client asks for a new slot: the row is revived and the write goes
    // through, exactly as before.
    const again = await reserve(env, 'book.epub', 6);
    expect(again.response.status).toBe(200);
    const put = await putObject(env, again.key, again.writeTicket, 'hello!');
    expect(put.status).toBe(200);
    expect(new TextDecoder().decode(env.LIBRARY_BUCKET.objects.get(again.key)!.body)).toBe(
      'hello!',
    );
  });
});
