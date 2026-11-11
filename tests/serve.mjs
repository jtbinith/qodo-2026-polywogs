// Serves web/ on 127.0.0.1 only (never on the network), for local testing.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../web/', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

export function serve(port = 5199) {
  const server = http.createServer(async (req, res) => {
    let file;
    try { file = join(ROOT, normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '') || 'index.html'); }
    catch { res.writeHead(400).end(); return; }                          // malformed URL
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }      // no escaping web/
    let body;
    try { body = await readFile(file); } catch { res.writeHead(404).end(); return; }   // read first, then answer once
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await serve(Number(process.env.PORT) || 5199);
  console.log(`serving web/ on http://127.0.0.1:${s.address().port}/`);
}
