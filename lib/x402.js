// lib/x402.js — shared x402 (exact scheme, EIP-3009) helpers.
//
// Challenge format mirrors the live 402 response observed at
// https://worker-readyjs.acecarace3.workers.dev/quote (x402Version 2).
// CORRECTION (verified 2026-11-16): the task brief named USDC on Base as
// 0x833589fCD6eDb6E08f4c7D8B227fD669cB54eA6, but that string is only 39
// hex chars — NOT a valid address (ethers.isAddress = false). The
// canonical USDC on Base, confirmed via CoinGecko and the reference
// endpoint, is 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913. That is what
// this build uses. The brief's address must be corrected in MEMORY.md.
import { ethers } from 'ethers';

export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // canonical USDC on Base (verified via CoinGecko)
export const CHAIN_ID = 8453;
export const NETWORK = 'eip155:8453';
export const PAY_TO = '0x66ce1B914E15f346FC9fDB80e556A017c092E5A4'; // vAPI account owner wallet (Base) — payout destination, per user instruction 2026-11-17
export const AMOUNT = '1000'; // $0.001 USDC (USDC has 6 decimals)
export const SCHEME = 'exact';
export const MAX_TIMEOUT_SECONDS = 120;
export const PRICE_DESCRIPTION = 'Live USD price for one cryptocurrency (CoinGecko)';

// EIP-712 domain for USDC transferWithAuthorization (EIP-3009).
export const EIP712_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: CHAIN_ID,
  verifyingContract: USDC_BASE,
};

export const EIP712_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

// In-memory set of spent authorization nonces (replay protection).
// NOTE: on Vercel serverless this is per-instance only. A production
// deployment should use shared storage (e.g. Vercel KV / Redis) for nonces.
const usedNonces = new Set();

/** Build the HTTP 402 challenge (body + headers), mirroring the reference. */
export function buildChallenge(resourceUrl) {
  const body = {
    x402Version: 2,
    error: 'Payment required',
    resource: {
      url: resourceUrl,
      description: PRICE_DESCRIPTION,
      mimeType: 'application/json',
    },
    accepts: [
      {
        scheme: SCHEME,
        network: NETWORK,
        amount: AMOUNT,
        asset: USDC_BASE,
        payTo: PAY_TO,
        resource: resourceUrl,
        description: PRICE_DESCRIPTION,
        mimeType: 'application/json',
        maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
        extra: { name: 'USD Coin', version: '2' },
      },
    ],
  };
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64');
  return {
    status: 402,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'access-control-expose-headers': 'PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE',
      'PAYMENT-REQUIRED': encoded,
    },
    body,
  };
}

/**
 * Verify an X-Payment header (base64 JSON, x402 exact scheme).
 * Checks: scheme/network, payTo, amount, validity window, nonce reuse,
 * and the EIP-712 signature (ecrecover) against the payer address.
 * Returns { ok: true, from } or { ok: false, reason }.
 */
export function verifyPayment(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') {
    return { ok: false, reason: 'missing X-Payment header' };
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(headerValue, 'base64').toString('utf8'));
  } catch {
    return { ok: false, reason: 'X-Payment is not valid base64 JSON' };
  }
  if (payload.x402Version !== 2 && payload.x402Version !== 1) {
    return { ok: false, reason: 'unsupported x402Version' };
  }
  if (payload.scheme !== SCHEME) return { ok: false, reason: 'unsupported scheme' };
  if (payload.network !== NETWORK) return { ok: false, reason: 'wrong network' };

  const p = payload.payload || {};
  const auth = p.authorization || {};
  const signature = p.signature;
  if (
    !signature ||
    !auth.from ||
    !auth.to ||
    auth.value === undefined ||
    auth.validAfter === undefined ||
    auth.validBefore === undefined ||
    !auth.nonce
  ) {
    return { ok: false, reason: 'incomplete authorization payload' };
  }

  let from;
  let to;
  try {
    from = ethers.getAddress(auth.from);
    to = ethers.getAddress(auth.to);
  } catch {
    return { ok: false, reason: 'malformed from/to address' };
  }
  if (to.toLowerCase() !== PAY_TO.toLowerCase()) {
    return { ok: false, reason: 'payTo mismatch' };
  }

  let value;
  let validAfter;
  let validBefore;
  try {
    value = BigInt(auth.value);
    validAfter = BigInt(auth.validAfter);
    validBefore = BigInt(auth.validBefore);
  } catch {
    return { ok: false, reason: 'malformed numeric field' };
  }
  if (value !== BigInt(AMOUNT)) return { ok: false, reason: 'amount mismatch' };

  const now = BigInt(Math.floor(Date.now() / 1000));
  if (validAfter > now) return { ok: false, reason: 'authorization not yet valid' };
  if (validBefore <= now) return { ok: false, reason: 'authorization expired' };

  if (typeof auth.nonce !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(auth.nonce)) {
    return { ok: false, reason: 'malformed nonce' };
  }
  const nonceKey = auth.nonce.toLowerCase();
  if (usedNonces.has(nonceKey)) return { ok: false, reason: 'nonce already used (replay)' };

  const authValue = {
    from,
    to,
    value: String(auth.value),
    validAfter: String(auth.validAfter),
    validBefore: String(auth.validBefore),
    nonce: auth.nonce,
  };
  let recovered;
  try {
    recovered = ethers.verifyTypedData(EIP712_DOMAIN, EIP712_TYPES, authValue, signature);
  } catch {
    return { ok: false, reason: 'signature verification failed' };
  }
  if (recovered.toLowerCase() !== from.toLowerCase()) {
    return { ok: false, reason: 'signature does not match payer' };
  }

  usedNonces.add(nonceKey);
  return { ok: true, from };
}
