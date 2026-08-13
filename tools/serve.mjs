/**
 * serve.mjs - a static server over the project folder, for looking at the
 * built page in a real browser context.
 *
 * Why it exists: opened as `file://` (or worse, as a `data:` page in a preview
 * pane) the application has no `localStorage`, and without storage there is no
 * way to drop a fixture in and land on the game screen. Over
 * `http://localhost` storage works like anywhere else, so
 * `tools/make-fixture.mjs` pastes in exactly as it would on a phone.
 *
 * It is a development tool. Nothing in `src/` imports it and nothing of it
 * reaches the built file.
 *
 *   node tools/serve.mjs               http://localhost:8137/Usogui_Maze_yev.html
 *   node tools/serve.mjs --port=9000   another port
 *
 * No dependencies, no configuration, no directory listing: it hands out the
 * files of this folder and nothing above it.
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// `new URL('..')` comes back with a trailing separator; every comparison below
// wants it without one.
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[/\\]$/, '');
const DEFAULT_PORT = 8137;

/** Content types this project actually serves. */
const TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
});

/**
 * Turns a request path into a file inside the project, or null.
 *
 * Anything that climbs out of the project folder is refused rather than
 * corrected: this server is pointed at a folder with source code in it.
 *
 * @param {string} url Request url.
 * @returns {string|null} Absolute path, or null when it leaves the root.
 */
export function resolvePath(url) {
  const withoutQuery = url.split('?')[0].split('#')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    // A malformed escape is not a path.
    return null;
  }
  const relative = normalize(decoded).replace(/^([/\\])+/, '');
  if (relative.split(/[/\\]/).includes('..')) {
    return null;
  }
  const full = join(ROOT, relative === '' ? 'Usogui_Maze_yev.html' : relative);
  return full === ROOT || full.startsWith(ROOT + sep) ? full : null;
}

/**
 * Reads the port from the command line.
 *
 * @param {string[]} argv Arguments after the script name.
 * @returns {number} The port.
 * @throws {Error} If the port is not a number.
 */
export function parsePort(argv) {
  const found = argv.find((argument) => argument.startsWith('--port='));
  if (found === undefined) {
    return DEFAULT_PORT;
  }
  const port = Number(found.slice('--port='.length));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`--port needs a number between 1 and 65535, got ${found}`);
  }
  return port;
}

/**
 * Starts the server.
 *
 * @param {number} [port=DEFAULT_PORT] Port to listen on.
 * @returns {Promise<{port: number, close: () => Promise<void>}>} The running
 *   server.
 */
export function serve(port = DEFAULT_PORT) {
  const server = createServer(async (request, response) => {
    const path = resolvePath(request.url ?? '/');
    if (path === null) {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('outside the project folder');
      return;
    }
    try {
      const info = await stat(path);
      if (info.isDirectory()) {
        response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('no directory listing');
        return;
      }
      response.writeHead(200, {
        'content-type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
        // The point of this server is looking at the file you just built.
        'cache-control': 'no-store',
      });
      createReadStream(path).pipe(response);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('not found');
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

if (process.argv[1]?.endsWith('serve.mjs')) {
  const port = parsePort(process.argv.slice(2));
  await serve(port);
  process.stdout.write(`http://localhost:${port}/Usogui_Maze_yev.html\n`);
}
