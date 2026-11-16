# vAPI Price API

API harga kripto di balik paywall x402 — $0.001 USDC per request (Base, chain
8453, exact scheme). Dibangun untuk misi vAPI **"List your API"** (500 poin).
Payout wallet: `0xA6F834Dd7737b81E4cA51790F325cAc3C12447c3` (dompet agen vAPI).

## Route

| Route | Bayar? | Keterangan |
|---|---|---|
| `GET /price?coin=<id-coingecko>` (default `bitcoin`) | Ya, x402 | Tanpa payment -> HTTP 402 + header `PAYMENT-REQUIRED`. Dengan header `X-Payment` (otorisasi EIP-3009 yang sudah ditandatangani, terverifikasi via ecrecover) -> harga live dari CoinGecko. |
| `GET /health` | Gratis | `{"ok":true}` |
| `GET /openapi.json` | Gratis | Dokumen OpenAPI 3. |

## Struktur

```
vapi-price-api/
  api/price.js        # route /price (x402)
  api/health.js       # route /health
  api/openapi.js      # route /openapi.json (menyajikan openapi.json)
  openapi.json        # dokumen OpenAPI 3 (single source of truth)
  lib/x402.js         # bangun 402 challenge + verifikasi X-Payment (ethers)
  server.js           # DEV ONLY: runner lokal (bukan dipakai Vercel)
  test/local-tests.mjs# tes lokal (npm test)
  vercel.json         # maxDuration 10 dtk untuk api/*
  package.json        # satu-satunya dependensi runtime: ethers
```

## Jalankan lokal

```bash
npm install
npm start            # http://localhost:3000
npm test             # tes otomatis (server tes di port 3101, dimatikan sendiri)
```

Tes `npm test` mencakup: (a) `/price` tanpa payment -> 402 + terms benar,
(b) `X-Payment` palsu -> 402, (c) `/health` -> 200, (d) `/openapi.json` ->
200 JSON valid, (e) payment valid yang ditandatangani dompet tes sekali pakai
-> 200 harga live, (e2) replay payment yang sama -> 402 (nonce reuse ditolak).
Dompet tes dibuat di memori saja, tidak pernah didanai/disimpan/dicetak.

## Deploy (langkah berikut — BELUM dilakukan)

1. User buat repo GitHub publik baru yang kosong (mis. `vapi-price-api`).
2. Push isi folder ini ke repo itu.
3. Import repo ke Vercel (deploy otomatis; tidak perlu build step).
4. Catat URL publiknya, update `servers[0].url` di `openapi.json`.
5. Submit URL itu di halaman vAPI **Add an API** dari HP (butuh sesi dompet
   0x66ce...), lalu ikuti langkah Discover -> Describe -> Payout -> Saved.

## Catatan penting

- **Koreksi alamat USDC (terverifikasi 2026-11-16):** brief awal menyebut
  USDC Base `0x833589fCD6eDb6E08f4c7D8B227fD669cB54eA6`, tapi alamat itu hanya
  39 karakter hex — BUKAN alamat valid (`ethers.isAddress` = false). USDC
  kanonis di Base, dikonfirmasi via CoinGecko, adalah
  `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` — itulah yang dipakai build ini.
  Alamat yang salah itu juga ada di MEMORY.md dan perlu dikoreksi.
- **Settlement on-chain belum ada:** server ini memverifikasi signature
  EIP-3009 dan menolak replay, tapi TIDAK mengeksekusi `transferWithAuthorization`
  di chain (itu tugas facilitator). Untuk listing vAPI, discovery hanya
  memverifikasi challenge 402-nya; settlement penuh adalah langkah berikut
  bila diperlukan.
- **Nonce store in-memory:** perlindungan replay per instance serverless saja.
  Produksi sebaiknya pakai storage bersama (mis. Vercel KV/Redis).
- Harga dari CoinGecko public API (tanpa key, rate limit publik berlaku).
