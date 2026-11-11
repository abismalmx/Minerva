/**
 * @vitest-environment node
 *
 * PoC de auditoría de seguridad (corrida 20261029-180924-7629).
 *
 * Cada test falla SI el defecto existe. Se ejecutan dentro del sandbox
 * (podman, sin red, sobre una copia en RAM): nunca en el host.
 *
 * Grupo A — hallazgos ya corregidos por la sesion paralela (regresion):
 *   A-01 el reloj por campo de un envelope se valida contra el desvio.
 *   A-03 el bloqueo por intentos fallidos decae al caducar.
 *   A-04 el registro de cuentas tiene limite de ritmo.
 *
 * Grupo B — hallazgos SIN cobertura (este informe):
 *   B-01 `GET /api/sync?limit=` no tiene tope: el limite del cliente anula
 *        el tope por defecto y la respuesta no tiene techo.
 *   B-02 `POST /api/storage/download` acepta un array `fileKeys` sin tope: una
 *        sola peticion dispara una consulta D1 y un HMAC por clave.
 *   B-03 `DELETE /api/storage/delete` acepta `fileKeys` sin tope: una consulta
 *        D1 y un borrado R2 por clave.
 *   B-04 `POST /api/sync/replica-keys` guarda `salt`, `salt_id` y `envelope`
 *        sin ningun tope de longitud.
 */
import { describe, it, expect } from 'vitest';

import { handleReplicaPost } from '../../../workers/minerva-sync/src/replicas';
import { handleLogin, handleRegister } from '../../../workers/minerva-sync/src/accounts';
import { handleSyncGet } from '../../../workers/minerva-sync/src/pull';
import {
  handleStorageDelete,
  handleStorageDownload,
  handleStorageList,
} from '../../../workers/minerva-sync/src/storage';
import { handleReplicaKeysCreate } from '../../../workers/minerva-sync/src/replicaKeys';
import { MemoryR2, SqliteD1, TEST_SECRET } from './minerva-sync-doubles';

interface TestEnv {
  JWT_SECRET: string;
  // The PBKDF2 cost of the real deployment (600 000) is paid on every
  // registration and sign-in; the suite runs the same code with a cost that
  // keeps it fast. `minerva-sync-kdf.test.ts` checks the production default.
  PASSPHRASE_KDF_ITERATIONS: string;
  ALLOWED_ORIGINS: string;
  MAX_UPLOAD_BYTES: string;
  STORAGE_FIXED_QUOTA: string;
  SYNC_DB: SqliteD1;
  LIBRARY_BUCKET: MemoryR2;
}

const makeEnv = (): TestEnv => ({
  JWT_SECRET: TEST_SECRET,
  PASSPHRASE_KDF_ITERATIONS: '10000',
  ALLOWED_ORIGINS: '*',
  MAX_UPLOAD_BYTES: '104857600',
  STORAGE_FIXED_QUOTA: '0',
  SYNC_DB: SqliteD1.withMigrations(),
  LIBRARY_BUCKET: new MemoryR2(),
});

const USER_ID = '11111111-2222-3333-4444-555555555555';

const req = (url: string, init: RequestInit = {}) =>
  new Request(url.startsWith('http') ? url : `https://worker.test${url}`, init);

const jsonBody = (obj: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj),
});

const hlc = (deviceId: string, counter = 0, offsetMs = 0): string => {
  const ms = Date.now() + offsetMs;
  return `${ms.toString(16).padStart(13, '0')}-${counter.toString(16).padStart(8, '0')}-${deviceId}`;
};

const hlcAt = (physicalMs: number, deviceId: string, counter = 0): string =>
  `${physicalMs.toString(16).padStart(13, '0')}-${counter.toString(16).padStart(8, '0')}-${deviceId}`;

/**
 * Envuelve el doble D1 para observar las consultas que emite el Worker.
 *
 * `limits` recoge el valor del `LIMIT ?` de cada consulta; `queries` cuenta
 * las consultas ejecutadas. Sirve para comprobar que un endpoint acota el
 * trabajo que hace, no sólo lo que devuelve.
 */
const spyOn = (env: TestEnv) => {
  const limits: number[] = [];
  let queries = 0;
  const original = env.SYNC_DB.prepare.bind(env.SYNC_DB);
  (env.SYNC_DB as unknown as { prepare: unknown }).prepare = (sql: string) => {
    queries += 1;
    const statement = original(sql);
    const bind = statement.bind.bind(statement);
    statement.bind = (...values: unknown[]) => {
      if (/LIMIT\s+\?/i.test(sql) && values.length > 0) {
        const last = Number(values[values.length - 1]);
        if (Number.isFinite(last)) limits.push(last);
      }
      return bind(...values);
    };
    return statement;
  };
  return { limits, count: () => queries };
};

describe('A · regresión de hallazgos ya corregidos', () => {
  it('A-01 rechaza un envelope cuyo reloj de campo está fuera del desvío', async () => {
    const env = makeEnv();
    const farFuture = hlcAt(Date.now() + 1000 * 60 * 60 * 24 * 365 * 50, 'device-evil');
    const response = await handleReplicaPost(
      req(
        '/api/sync/replicas',
        jsonBody({
          rows: [
            {
              user_id: USER_ID,
              kind: 'settings',
              replica_id: 'singleton',
              fields_jsonb: { alpha: { v: 'a', t: farFuture, s: 'device-evil' } },
              manifest_jsonb: null,
              deleted_at_ts: null,
              reincarnation: null,
              updated_at_ts: hlc('device-evil'),
              schema_version: 1,
            },
          ],
        }),
      ),
      env as never,
      USER_ID,
    );
    expect(response.status).toBe(409);
  });

  it('A-03 el bloqueo por intentos fallidos decae al caducar', async () => {
    const env = makeEnv();
    const email = 'bloqueo@example.com';
    await handleRegister(
      req('/api/auth/register', jsonBody({ email, passphrase: 'una-passphrase-larga' })),
      env as never,
    );
    for (let i = 0; i < 5; i++) {
      await handleLogin(
        req('/api/auth/login', jsonBody({ email, passphrase: 'incorrecta' })),
        env as never,
      );
    }
    await env.SYNC_DB.prepare('UPDATE login_attempts SET locked_until = ? WHERE email = ?')
      .bind(Math.floor(Date.now() / 1000) - 1, email)
      .run();
    await handleLogin(
      req('/api/auth/login', jsonBody({ email, passphrase: 'incorrecta' })),
      env as never,
    );
    const after = await env.SYNC_DB.prepare('SELECT attempts FROM login_attempts WHERE email = ?')
      .bind(email)
      .first<{ attempts: number }>();
    expect(Number(after?.attempts ?? 0)).toBeLessThanOrEqual(5);
  });

  it('A-04 el registro de cuentas tiene límite de ritmo', async () => {
    const env = makeEnv();
    let created = 0;
    for (let i = 0; i < 40; i++) {
      const response = await handleRegister(
        req(
          '/api/auth/register',
          jsonBody({ email: `alta${i}@example.com`, passphrase: 'una-passphrase-larga' }),
        ),
        env as never,
      );
      if (response.status === 201) created += 1;
    }
    expect(created).toBeLessThan(40);
  });
});

/**
 * Grupo B — hallazgos que esta auditoría encontró y corrigió.
 *
 * Cada test es un test de regresión: falla si el defecto vuelve. Antes del
 * parche fallaban (rojo); con el parche pasan (verde).
 */
describe('B · hallazgos corregidos por esta auditoría', () => {
  it('B-01 el límite de `GET /api/sync` tiene techo', async () => {
    const env = makeEnv();
    const spy = spyOn(env);
    const response = await handleSyncGet({
      request: req('/api/sync?since=0&limit=100000000'),
      env: env as never,
      userId: USER_ID,
    });
    expect(response.status).toBe(200);
    // El `limit` que el cliente pide no puede anular el tope del servidor:
    // sin tope, una sola respuesta arrastra la biblioteca entera y agota la
    // memoria del Worker (128 MB).
    expect(spy.limits.length).toBeGreaterThan(0);
    for (const limit of spy.limits) {
      expect(limit).toBeLessThanOrEqual(50_000);
    }
  });

  it('B-02 `POST /api/storage/download` acota el número de claves', async () => {
    const env = makeEnv();
    const spy = spyOn(env);
    const fileKeys = Array.from({ length: 5000 }, (_, i) => `${USER_ID}/libro-${i}.epub`);
    const response = await handleStorageDownload(
      req('/api/storage/download', jsonBody({ fileKeys })),
      env as never,
      USER_ID,
    );
    expect(response.status).toBe(400);
    // Una peticion no puede lanzar miles de consultas D1: el limite de
    // consultas por invocacion del runtime (1000 de pago, 50 gratuito) se
    // agotaria y la peticion moriria.
    expect(spy.count()).toBeLessThanOrEqual(101);
  });

  it('B-02 una descarga masiva legitima sigue funcionando y no gasta una consulta por clave', async () => {
    const env = makeEnv();
    const spy = spyOn(env);
    const fileKeys = Array.from({ length: 200 }, (_, i) => `${USER_ID}/portada-${i}.epub`);
    const response = await handleStorageDownload(
      req('/api/storage/download', jsonBody({ fileKeys })),
      env as never,
      USER_ID,
    );
    // El cliente pide las portadas de TODA la biblioteca en una peticion: el
    // tope no puede romper ese caso.
    expect(response.status).toBe(200);
    // 200 claves en consultas de 99: un puñado, no 200.
    expect(spy.count()).toBeLessThanOrEqual(5);
  });

  it('B-03 `DELETE /api/storage/delete` acota el número de claves', async () => {
    const env = makeEnv();
    const spy = spyOn(env);
    const fileKeys = Array.from({ length: 5000 }, (_, i) => `${USER_ID}/libro-${i}.epub`);
    const response = await handleStorageDelete(
      req('/api/storage/delete', { ...jsonBody({ fileKeys }), method: 'DELETE' }),
      env as never,
      USER_ID,
    );
    expect(response.status).toBe(400);
    expect(spy.count()).toBeLessThanOrEqual(101);
  });

  it('B-04 `POST /api/sync/replica-keys` acota el tamaño de la sal', async () => {
    const env = makeEnv();
    const response = await handleReplicaKeysCreate(
      req(
        '/api/sync/replica-keys',
        jsonBody({ alg: 'pbkdf2-600k-sha256', salt: 'A'.repeat(2 * 1024 * 1024) }),
      ),
      env as never,
      USER_ID,
    );
    expect(response.status).toBe(400);
  });

  it('B-04 `POST /api/sync/replica-keys` sigue aceptando una sal razonable', async () => {
    const env = makeEnv();
    const response = await handleReplicaKeysCreate(
      req('/api/sync/replica-keys', jsonBody({ alg: 'pbkdf2-600k-sha256' })),
      env as never,
      USER_ID,
    );
    expect(response.status).toBe(201);
  });

  it('B-06 `GET /api/storage/list` aguanta una búsqueda larga', async () => {
    const env = makeEnv();
    const response = await handleStorageList(
      req(`/api/storage/list?search=${'x'.repeat(200)}`),
      env as never,
      USER_ID,
    );
    // D1 limita el patron LIKE a 50 bytes: una busqueda mas larga hacia
    // fallar la consulta con un 500 que el cliente no puede explicar.
    expect(response.status).toBe(200);
  });
});
