const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8090);
const root = __dirname;
const types = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  png: 'image/png',
  ico: 'image/x-icon',
  json: 'application/json',
};

http
  .createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    const file = path.normalize(path.join(root, urlPath));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, { 'Content-Type': types[path.extname(file).slice(1)] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log(`Pointbreak admin dashboard on http://localhost:${PORT}`));