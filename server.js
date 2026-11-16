// server.js — DEV ONLY local runner (not used by Vercel).
// Routes the Vercel-style handlers (req, res) over plain node:http so the
// API can be tested locally without `vercel dev`.
import http from 'node:http';
import priceHandler from './api/price.js';
import healthHandler from './api/health.js';
import openapiHandler from './api/openapi.js';

const PORT = Number(process.env.PORT || 3000);

const routes = {
  '/price': priceHandler,
  '/health': healthHandler,
  '/openapi.json': openapiHandler,
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  req.query = Object.fromEntries(url.searchParams.entries());
  const handler = routes[url.pathname];
  if (!handler) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  Promise.resolve(handler(req, res)).catch((err) => {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    if (!res.writableEnded) res.end(JSON.stringify({ error: 'internal error' }));
  });
});

server.listen(PORT, () => console.log(`vapi-price-api (dev) listening on http://localhost:${PORT}`));
