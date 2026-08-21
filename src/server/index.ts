import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Repository } from './repository.js';
import { handleRpc } from './routes.js';

const MAX_BODY_BYTES = 64 * 1024;
const SHUTDOWN_TIMEOUT_MS = 4000;

/** stdout is reserved for the single readiness line — everything else goes to stderr. */
function log(message: string): void {
  process.stderr.write(`[taskwork] ${message}\n`);
}

function readVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const manifest: unknown = JSON.parse(fs.readFileSync(path.resolve(here, '..', '..', 'manifest.json'), 'utf8'));
    const version = (manifest as { version?: unknown }).version;
    return typeof version === 'string' ? version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

export function createServer(repository: Repository, version: string): http.Server {
  return http.createServer((request, response) => {
    void (async () => {
      const method = request.method ?? 'GET';
      const pathname = (request.url ?? '/').split('?')[0] ?? '/';

      let result;
      try {
        const raw = await readBody(request);
        const body: unknown = raw.length > 0 ? JSON.parse(raw) : undefined;
        result = await handleRpc({ repository, version }, method, pathname, body);
      } catch (error) {
        result = {
          status: 400,
          body: { error: { code: 'VALIDATION_ERROR', message: `Malformed request: ${(error as Error).message}` } },
        };
      }

      const payload = JSON.stringify(result.body);
      response.writeHead(result.status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
        'cache-control': 'no-store',
      });
      response.end(payload);
    })();
  });
}

function main(): void {
  // The store is loaded before listen(): the host allows 10 s to report ready,
  // and a client must never see an empty store that is still loading.
  const repository = Repository.open();
  const version = readVersion();
  const server = createServer(repository, version);

  server.on('error', (error) => {
    log(`server error: ${String(error)}`);
    process.exit(1);
  });

  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (address && typeof address !== 'string') {
      process.stdout.write(`${JSON.stringify({ ready: true, port: address.port })}\n`);
      log(`listening on 127.0.0.1:${address.port}, store ${repository.storePath}`);
    }
  });

  const shutdown = (signal: string): void => {
    log(`${signal} received, shutting down`);
    const force = setTimeout(() => process.exit(0), SHUTDOWN_TIMEOUT_MS);
    force.unref();
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Only run when started as the plugin's server entry, never on import from tests.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
