/**
 * Minimal structural types for the Cloudflare runtime APIs this Worker uses.
 *
 * The project does not depend on `@cloudflare/workers-types` — the app's own
 * `worker.ts` says the same and carries its own minimal types for the same
 * reason. The Worker's own `tsconfig.json` does include
 * `@cloudflare/workers-types`, but the app's `tsconfig.json` also compiles
 * these files (the unit tests import them), and it has no Cloudflare globals.
 *
 * Declaring the shapes locally keeps the source valid under BOTH
 * configurations: inside a module, a local declaration simply shadows the
 * global one.
 */

/** A stored R2 object. */
export interface R2ObjectBody {
  /** The object's bytes, or null for a zero-length object. */
  body: ReadableStream | null;
  /** The object's HTTP ETag. */
  httpEtag?: string;
  /** The metadata set when the object was written. */
  httpMetadata?: { contentType?: string };
  /** The object's size in bytes. */
  size?: number;
}

/** The options an R2 write accepts. */
export interface R2PutOptions {
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

/** The R2 bucket binding. */
export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null,
    options?: R2PutOptions,
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
  list?(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    objects: Array<{ key: string; size: number }>;
    truncated?: boolean;
    cursor?: string;
  }>;
}

/** The result of a D1 query. */
export interface D1Result<T = Record<string, unknown>> {
  /** The rows the query returned. */
  results: T[];
  /** Whether the query succeeded. */
  success: boolean;
  /** Query metadata (row counts, timings). */
  meta?: { changes?: number; last_row_id?: number; [key: string]: unknown };
}

/** A prepared D1 statement. */
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

/** The D1 database binding. */
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  /** Run the statements in order, rolling the whole batch back on failure. */
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

/** A Cloudflare Worker exported handler. */
export interface ExportedHandler<Env = unknown> {
  fetch?: (request: Request, env: Env, ctx?: unknown) => Promise<Response> | Response;
}
