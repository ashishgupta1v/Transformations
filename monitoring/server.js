// monitoring/server.js
// Zero-dependency static server for the monitoring dashboard. Serves
// dashboard.html at "/" and exposes two small JSON endpoints so the page
// can read real pipeline data without needing a database:
//   GET /api/cost-log  -> contents of data/cost-log.json (or { runs: [] })
//   GET /api/runs      -> filenames found in data/runs/ (or [])
//
// (package.json's previous one-liner "dashboard" script always returned
// dashboard.html for every path, which meant the page's own fetch() calls
// could never reach real JSON. This replaces that one-liner.)

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.DASHBOARD_PORT || 8088;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function serveStatic(req, res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/api/cost-log') {
    const logPath = path.join(ROOT, 'data', 'cost-log.json');
    fs.readFile(logPath, 'utf8', (err, content) => {
      if (err) return sendJson(res, 200, { runs: [] });
      try {
        return sendJson(res, 200, JSON.parse(content));
      } catch {
        return sendJson(res, 200, { runs: [] });
      }
    });
    return;
  }

  if (url === '/api/runs') {
    const runsDir = path.join(ROOT, 'data', 'runs');
    fs.readdir(runsDir, (err, files) => {
      if (err) return sendJson(res, 200, []);
      return sendJson(res, 200, files.filter((f) => f.endsWith('.json')));
    });
    return;
  }

  if (url === '/' || url === '') {
    return serveStatic(req, res, path.join(__dirname, 'dashboard.html'));
  }

  // Fall back to serving any other static file under monitoring/
  return serveStatic(req, res, path.join(__dirname, url));
});

server.listen(PORT, () => {
  console.log(`📊 Jagannatha Pipeline Dashboard: http://localhost:${PORT}`);
});
