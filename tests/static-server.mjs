import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('../docs/', import.meta.url)));
const prefix = '/covenant-between-web-peers/';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
http.createServer(async (req, res) => {
    try {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        if (!pathname.startsWith(prefix)) { res.writeHead(404); res.end(); return; }
        const target = path.resolve(root, pathname.slice(prefix.length) || 'index.html');
        if (!target.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
        const bytes = await readFile(target);
        res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
}).listen(4173, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:4173${prefix}`));
