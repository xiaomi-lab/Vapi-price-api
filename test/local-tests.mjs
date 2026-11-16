// test/local-tests.mjs — local tests for vapi-price-api (no real funds spent).
// Spawns the dev server, runs the checks, kills the server, prints PASS/FAIL.
//
// Test (e) uses an EPHEMERAL throwaway wallet created in memory only
// (ethers.Wallet.createRandom). It is never funded, never printed, and
// never saved anywhere — it only signs a test EIP-3009 authorization.
import { spawn } from 'node:child_process';
import { ethers } from 'ethers';
import { EIP712_DOMAIN, EIP712_TYPES, USDC_BASE, PAY_TO, AMOUNT } from '../lib/x402.js';

const PORT = Number(process.env.TEST_PORT || 3101);
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function waitForHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.status === 200) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function main() {
  const server = spawn('node', ['server.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });

  try {
    if (!(await waitForHealth())) {
      console.log('FAIL  server did not start');
      console.log(serverLog);
      process.exitCode = 1;
      return;
    }

    // (a) GET /price without payment -> 402 + PAYMENT-REQUIRED header + JSON body
    {
      const r = await fetch(`${BASE}/price?coin=bitcoin`);
      const body = await r.json().catch(() => null);
      const header = r.headers.get('payment-required');
      let decoded = null;
      try { decoded = JSON.parse(Buffer.from(header || '', 'base64').toString('utf8')); } catch { /* bad */ }
      const termsOk =
        decoded?.accepts?.[0]?.scheme === 'exact' &&
        decoded?.accepts?.[0]?.network === 'eip155:8453' &&
        decoded?.accepts?.[0]?.amount === AMOUNT &&
        decoded?.accepts?.[0]?.asset?.toLowerCase() === USDC_BASE.toLowerCase() &&
        decoded?.accepts?.[0]?.payTo?.toLowerCase() === PAY_TO.toLowerCase();
      const bodyMatches = body && decoded && JSON.stringify(body) === JSON.stringify(decoded);
      check(
        '(a) GET /price tanpa payment -> 402 + header PAYMENT-REQUIRED + terms benar',
        r.status === 402 && !!header && termsOk && bodyMatches,
        `status=${r.status} header=${!!header} termsOk=${termsOk} bodyMatchesHeader=${bodyMatches}`,
      );
      if (decoded) {
        console.log('      challenge terms:', JSON.stringify(decoded.accepts[0]));
      }
    }

    // (b) GET /price dengan X-Payment palsu -> 402 lagi (dua varian)
    {
      const garbage = await fetch(`${BASE}/price?coin=bitcoin`, {
        headers: { 'X-Payment': Buffer.from('bukan-json-yang-valid').toString('base64') },
      });
      const fakeAuth = {
        x402Version: 2,
        scheme: 'exact',
        network: 'eip155:8453',
        payload: {
          signature: `0x${'00'.repeat(65)}`,
          authorization: {
            from: '0x0000000000000000000000000000000000000001',
            to: PAY_TO,
            value: AMOUNT,
            validAfter: '0',
            validBefore: String(Math.floor(Date.now() / 1000) + 600),
            nonce: `0x${'11'.repeat(32)}`,
          },
        },
      };
      const badSig = await fetch(`${BASE}/price?coin=bitcoin`, {
        headers: { 'X-Payment': Buffer.from(JSON.stringify(fakeAuth)).toString('base64') },
      });
      check(
        '(b) GET /price dengan X-Payment palsu -> 402 lagi',
        garbage.status === 402 && badSig.status === 402,
        `garbage=${garbage.status} badSig=${badSig.status}`,
      );
    }

    // (c) GET /health -> 200
    {
      const r = await fetch(`${BASE}/health`);
      const body = await r.json().catch(() => null);
      check('(c) GET /health -> 200 {"ok":true}', r.status === 200 && body?.ok === true, `status=${r.status} body=${JSON.stringify(body)}`);
    }

    // (d) GET /openapi.json -> 200 dan valid JSON
    {
      const r = await fetch(`${BASE}/openapi.json`);
      const text = await r.text();
      let doc = null;
      try { doc = JSON.parse(text); } catch { /* invalid */ }
      const ok =
        r.status === 200 &&
        !!doc &&
        typeof doc.openapi === 'string' &&
        doc.openapi.startsWith('3.') &&
        !!doc.paths?.['/price'] &&
        !!doc.paths?.['/health'] &&
        !!doc.paths?.['/openapi.json'];
      check('(d) GET /openapi.json -> 200, JSON valid, memuat /price + /health', ok, `status=${r.status} openapi=${doc?.openapi} paths=${doc ? Object.keys(doc.paths || {}).join(',') : 'n/a'}`);
    }

    // (e) BONUS: payment valid yang ditandatangani dompet tes sekali pakai -> 200 harga live
    {
      const wallet = ethers.Wallet.createRandom(); // in-memory only, never printed/saved
      const now = Math.floor(Date.now() / 1000);
      const auth = {
        from: wallet.address,
        to: PAY_TO,
        value: AMOUNT,
        validAfter: '0',
        validBefore: String(now + 600),
        nonce: ethers.hexlify(ethers.randomBytes(32)),
      };
      const signature = await wallet.signTypedData(EIP712_DOMAIN, EIP712_TYPES, auth);
      const xPayment = Buffer.from(JSON.stringify({
        x402Version: 2,
        scheme: 'exact',
        network: 'eip155:8453',
        payload: { signature, authorization: auth },
      })).toString('base64');

      const r = await fetch(`${BASE}/price?coin=bitcoin`, { headers: { 'X-Payment': xPayment } });
      const body = await r.json().catch(() => null);
      const ok =
        r.status === 200 &&
        body?.coin === 'bitcoin' &&
        typeof body?.usd === 'number' &&
        body.usd > 0 &&
        body?.payer?.toLowerCase() === wallet.address.toLowerCase();
      check(
        '(e) GET /price dengan X-Payment valid (ditandatangani) -> 200 harga live',
        ok,
        `status=${r.status} body=${JSON.stringify(body)}`,
      );

      // Replay: header yang sama dipakai ulang -> 402 (nonce sudah terpakai)
      const replay = await fetch(`${BASE}/price?coin=bitcoin`, { headers: { 'X-Payment': xPayment } });
      check('(e2) Replay X-Payment yang sama -> 402 (nonce reuse ditolak)', replay.status === 402, `status=${replay.status}`);
    }
  } finally {
    server.kill('SIGTERM');
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} tes lolos.`);
  process.exitCode = failed ? 1 : 0;
}

main();
