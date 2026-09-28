// Minimal static server for the exported site, used by end-to-end tests. Honours NEXT_PUBLIC_BASE_PATH.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.argv[2] ?? 'out', port = Number(process.argv[3] ?? 4173), base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ttf': 'font/ttf',
  '.json': 'application/json', '.png': 'image/png', '.txt': 'text/plain', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

createServer(async (request, response) => {
  let path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  if (base && path.startsWith(base)) path = path.slice(base.length) || '/';
  let file = normalize(join(root, path));
  if (!file.startsWith(normalize(root))) { response.writeHead(403).end(); return; }
  try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); } catch { file = file.endsWith('.html') ? file : `${file}.html`; }
  try { const body = await readFile(file); response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(body); }
  catch { response.writeHead(404).end('not found'); }
}).listen(port, () => console.log(`serving ${root} at http://localhost:${port}${base}/`));
