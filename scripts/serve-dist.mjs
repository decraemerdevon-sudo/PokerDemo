import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const root = join(process.cwd(), 'dist');
const mimeTypes = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
};

createServer((request, response) => {
  const requestedPath = request.url === '/' ? '/index.html' : request.url ?? '/index.html';
  const filePath = normalize(join(root, requestedPath));
  const safePath = filePath.startsWith(root) && existsSync(filePath) ? filePath : join(root, 'index.html');

  response.setHeader('Content-Type', mimeTypes[extname(safePath)] ?? 'application/octet-stream');
  createReadStream(safePath).pipe(response);
}).listen(5173, '127.0.0.1', () => {
  console.log('Serving dist on http://127.0.0.1:5173');
});
