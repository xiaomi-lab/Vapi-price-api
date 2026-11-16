// api/price.js — GET /price?coin=<coingecko-id> (x402-paid, $0.001 USDC on Base).
// First call without payment -> HTTP 402 with PAYMENT-REQUIRED header.
// Repeat call with a signed EIP-3009 authorization in the X-Payment
// header -> live price from CoinGecko (public API, no key).
import { buildChallenge, verifyPayment, PAY_TO, AMOUNT } from '../lib/x402.js';

const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price';
const COIN_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;

function resourceUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const path = req.url || '/price';
  return `${proto}://${host}${path}`;
}

function sendChallenge(req, res) {
  const { status, headers, body } = buildChallenge(resourceUrl(req));
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const coin = (req.query?.coin || 'bitcoin').toString().toLowerCase();
  if (!COIN_RE.test(coin)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid coin id' }));
    return;
  }

  const payment = verifyPayment(req.headers['x-payment']);
  if (!payment.ok) {
    sendChallenge(req, res);
    return;
  }

  // Paid + signature verified: fetch the live price from CoinGecko.
  const url = `${COINGECKO_URL}?ids=${encodeURIComponent(coin)}&vs_currencies=usd&include_24hr_change=true`;
  let data;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timer);
    if (!r.ok) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'price source unavailable', status: r.status }));
      return;
    }
    data = await r.json();
  } catch {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'price source unavailable' }));
    return;
  }

  const entry = data?.[coin];
  if (!entry || typeof entry.usd !== 'number') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'coin not found', coin }));
    return;
  }

  const response = {
    coin,
    usd: entry.usd,
    usd_24h_change: entry.usd_24h_change ?? null,
    source: 'coingecko',
    paid: true,
    payer: payment.from,
    price: AMOUNT,
    currency: 'USDC',
    payTo: PAY_TO,
  };
  const paymentResponse = Buffer.from(
    JSON.stringify({
      x402Version: 2,
      success: true,
      payer: payment.from,
      network: 'eip155:8453',
      note: 'EIP-3009 signature verified; on-chain settlement is the payer/facilitator step for the live listing.',
    }),
  ).toString('base64');
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'PAYMENT-RESPONSE': paymentResponse,
    'X-PAYMENT-RESPONSE': paymentResponse,
  });
  res.end(JSON.stringify(response));
}
