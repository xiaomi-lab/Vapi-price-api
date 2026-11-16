// api/openapi.js — GET /openapi.json (free). Serves the root openapi.json.
import spec from '../openapi.json' with { type: 'json' };

export default function handler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(spec));
}
