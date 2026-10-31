# PulseAlpha

A mobile-first PWA that surfaces 2–3 bullish NSE setups a day, each stamped with the exact IST time it was detected, a one-line catalyst, and ATR-based buy zone, target and stop-loss.

Next.js 16 (App Router) · TypeScript (strict + `noUncheckedIndexedAccess`) · Tailwind CSS 4 · Lucide · `yahoo-finance2` v4 · `@google/genai`

**No database.** Shared data lives in the Next.js server cache; Signal History lives in each browser's localStorage.

---

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

Open it on your phone (same Wi-Fi, `http://<your-ip>:3000`) or deploy and use **Add to Home Screen** — it installs as a standalone app with the `#090D16` theme.

Out of the box, with no keys:

- **Live mode** scans real Yahoo Finance data and ranks with the deterministic rules engine.
- Set `GEMINI_API_KEY` to switch ranking and the research write-up to Gemini. Everyone who opens the site sees the same shared scan.
- Set `OWNER_PASSCODE` to unlock the owner-only **API Setup** tab (personal key, model, demo mode) on your own devices. Visitors never see it.

## Deploy to Vercel

1. Push to GitHub and import into Vercel. No database, storage or integration to add.
2. Set these in Vercel → Settings → Environment Variables (never in the repo, never in chat):
   - `GEMINI_API_KEY` (optional): the Gemini key.
   - `OWNER_PASSCODE` (recommended): 12+ characters, ideally 20+ from a password manager. Without it nobody can sign in as owner and the API Setup tab stays hidden for everyone.
   - `GEMINI_MODEL` (optional).
3. `vercel.json` calls `GET /api/scan` at **03:00 UTC = 08:30 IST, Mon–Fri**, which fills the cache before anyone opens the app.

That's it. Vercel provides the cache that `unstable_cache` writes to and shares it across every serverless instance automatically.

---

## Caching

Two layers, both `unstable_cache` with `revalidate` (`src/lib/scan-service.ts`):

| Layer | Key | `revalidate` | What it saves |
|---|---|---|---|
| Market data — indices, ~90 stock snapshots, the hard filter, 24 h headlines | IST date | 180 s | ~95 Yahoo + Google News calls per scan |
| Gemini evaluation (server key only) | The exact JSON sent to the model | 6 h | Paying twice for identical data |

How requests use it:

- **Opening the app** calls `GET /api/scan`: the shared scan, normally answered from cache in a few milliseconds.
- **Scan Market Now** calls `POST /api/scan`: same cached market data, re-evaluated. With a personal Gemini key the AI step always runs on that key and is never cached across users.
- After 180 s, Next.js serves the cached data once more while refreshing it in the background (stale-while-revalidate). If an entry is more than 15 minutes old — the first visit after a quiet spell — the scan fetches fresh data in the foreground instead.
- The IST date is part of the key, so a new trading day never shows yesterday's data.
- Failures throw inside the cached function and are never cached. If Yahoo rate-limits an instance, it backs off for 60 s and prefers older real data (with its real timestamp) over simulated data.

Every card's "detected at" time is when its market data was fetched, so everyone served from the same cache entry sees the same picks with the same timestamp. `/api/scan` responses carry an `X-PulseAlpha-Cache: market=hit; ai=hit` header for debugging.

Why `unstable_cache` and not `'use cache'`: Next 16 recommends `'use cache'` with Cache Components, but its default store is in-memory per instance, which on serverless rarely survives between requests. `'use cache: remote'` fixes that but requires migrating the app to Cache Components. `unstable_cache` goes through Next's server cache handler, which Vercel backs with a shared, persistent cache today, with no config.

## Signal History

Stored only in the browser (`localStorage`, up to 300 rows). Each stock is logged once per IST day, at its first detection, so repeated scans don't flood the log. Demo and simulated rows are tagged and kept separate from live ones. Clearing site data or switching phones starts a fresh log.

---

## How a scan works

| Step | What happens | Where |
|---|---|---|
| 1. Global cues | Last-session change of `^GSPC`, `^IXIC`, `^NSEI` + Nifty vs its 20-EMA → regime score → Bullish / Neutral / Bearish | `lib/market-data.ts`, `lib/market-data-pure.ts` |
| 2. Indicators | ~90 liquid Nifty 200 names: 20/50-EMA, Wilder RSI(14), Wilder ATR(14), volume ratio — pure TypeScript | `lib/indicators.ts` |
| 3. Hard filter | Price > 20-EMA **and** 55 ≤ RSI ≤ 72 **and** volume ratio > 1.5x | `lib/rules-engine.ts` |
| 4. Catalysts | Google News RSS per shortlisted symbol, kept only if published in the last 24 h | `lib/news.ts` |
| 5. Evaluation | Gemini with a JSON schema whose `symbol` field is an **enum of the shortlist** → it cannot name a stock that didn't pass | `lib/gemini.ts` |
| 6. Levels | `entry` = price → price + 0.15·ATR, `target` = price + 2.5·ATR, `stop` = price − 1.5·ATR, rounded to the ₹0.05 tick | `lib/levels.ts` |

### Zero-hallucination guarantees

- **The model never sees an absolute price.** It receives only relative metrics (% above 20-EMA, RSI, volume multiple, ATR as % of price), so it cannot echo or distort a level.
- **Every number on a card comes from code.** AI output is limited to: which shortlisted symbols, their order, a conviction score, and prose.
- **AI prose that mentions ₹/Rs/INR or a "target of…" is discarded** and replaced with deterministic copy built from the real metrics.
- Hallucinated tickers, duplicates and malformed JSON are dropped; if Gemini fails, the rules engine ranks instead and the feed says so.
- If no stock passes the filter, the feed shows an empty state instead of forcing picks.

### Fallbacks

- Yahoo unusable (index data fails, or < 35% of symbols load) and nothing cached → **simulated data**, flagged with an amber banner and a `Simulated` tag in history. Simulated data is never cached.
- During NSE hours the forming daily bar is excluded: indicators use completed sessions, the live price is used for "price > 20-EMA" and the levels.
- `gemini-2.5-flash` was retired on 16 Oct 2026, so the default model is `gemini-3.5-flash`. On a 404 the server retries once with `gemini-flash-latest`. Override via `GEMINI_MODEL` or the Model field in API Setup.

## API

| Route | Purpose |
|---|---|
| `GET /api/scan` | The shared live scan (server key or rules engine), from cache when warm. Also the cron target. |
| `POST /api/scan` | **Owner only.** Body `{ mode?: "live" \| "demo", model?: string }`, optional header `x-gemini-key`. |
| `GET /api/verify` | **Owner only.** Accuracy report: filter funnel, raw sessions for cross-checking, ~9-month replay vs baseline. Cached per IST day. |
| `GET /api/config` | Capability flags only (never secrets). Server-key status is shown to the owner alone. |
| `POST /api/verify-key` | **Owner only.** One-word Gemini round-trip for the "Test key" button. |
| `GET` / `POST` / `DELETE /api/owner` | Session status / sign in with `{ passcode }` / sign out. |

## Security

The site is public; the owner's controls are not. Every owner-only route checks the session on the server, so hiding the tab is a courtesy, not the protection.

- **Owner session**: `OWNER_PASSCODE` lives only in Vercel's environment. Signing in sets an `HttpOnly`, `Secure`, `SameSite=Strict` cookie holding an expiry and an HMAC of it (key derived from the passcode with scrypt). Page scripts can't read it, other sites can't send it, and it can't be forged without the passcode. Sessions last 30 days; changing `OWNER_PASSCODE` signs every device out.
- **What visitors can do**: read the shared, cached scan (`GET /api/scan`). They can't spend a Gemini key, choose a model, run demo mode, test keys or trigger the 9-month accuracy replay. Opening the site more often never causes more Gemini calls: results are cached on the server.
- **Guessing**: a wrong passcode costs half a second, five misses lock that IP for 15 minutes, and a long passcode makes guessing hopeless. Add the Vercel Firewall rate-limit rule below for a global cap.
- **CSRF**: sign-in, sign-out and `POST /api/scan` refuse requests that declare themselves cross-site or carry a foreign `Origin`, on top of `SameSite=Strict`.
- **Headers** (`next.config.ts`): Content-Security-Policy limiting scripts, requests and framing to this origin, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `COOP`, HSTS.
- **Secrets**: keys live in Vercel environment variables only. `.env*` files are git-ignored, `/api/config` never returns a secret, and the server key is never sent to a browser.
- **Rate limit**: in Vercel → Project → Firewall → Add rule, match path `/api/owner`, action *Rate limit* (e.g. 10 requests per minute per IP). Optionally add a general rule for `/api/` (e.g. 120 per minute per IP).

## Check accuracy on real data before going live

Deploy a **Preview** on Vercel first (any non-production branch), then open:

- `https://<preview-url>/api/scan` — today's real ranked picks with every level.
- `https://<preview-url>/api/verify` — today's filter funnel, the last 3 sessions and computed indicators for RELIANCE, HDFCBANK, ICICIBANK, INFY and TCS (compare with any chart), and a replay of the same filter and ATR levels over roughly the last 9 months. It reports target-hit rate, stop-hit rate, win rate, average return and profit factor for the app's top picks, for all signals, and for a no-filter baseline. Built once per IST day and cached for 6 hours.

Or run the same check on your own machine:

```bash
npm run verify                        # rules engine
GEMINI_API_KEY=... npm run verify     # ranked by Gemini, as on Vercel
```

How to read it: with a +2.5 ATR target and −1.5 ATR stop, the strategy breaks even at a 37.5% target-hit rate if every trade ends at one or the other. Because some trades time out, **average return per trade** and **profit factor** (> 1 means profitable) are the honest headline numbers — and they should beat the baseline, or the filter isn't adding anything. Costs aren't deducted; allow ~0.25% per round trip.

## Tests

```bash
npm test             # indicators vs the StockCharts RSI reference, ATR, levels, IST formatting, regime, demo board
npm run test:live    # full live pipeline with Yahoo, Google News and Gemini mocked at the fetch layer
npm run build && npm run test:cache
                     # real `next start` + mocked upstream: counts upstream calls across requests and a restart
CACHE_TEST_REVALIDATE=1 npm run test:cache   # also waits out the 180 s window (~3 min)
npm run test:owner   # owner-mode primitives: tokens, expiry, forgery, passcode rotation, CSRF guard, lockout
npm run build && npm run test:access
                     # real `next start`: visitor vs owner vs forged cookies on every route, headers, brute force
npm run typecheck
```

## Notes and limits

- Yahoo Finance has no official API; `yahoo-finance2` is community-maintained and can break when Yahoo changes.
- NSE exchange holidays aren't modelled; on a holiday the scan reflects the last completed session.
- Edit the universe in `src/lib/watchlist.ts`. Symbols that fail to load are skipped.
- Self-hosting with `next start` uses the local filesystem cache in `.next/cache`, shared by that one server. Running several servers needs a shared [cache handler](https://nextjs.org/docs/app/api-reference/config/next-config-js/incrementalCacheHandlerPath); Vercel needs nothing.
- A Gemini key typed in API Setup (owner only) lives in that browser's localStorage and is sent to your own `/api/scan` on each request. Prefer the `GEMINI_API_KEY` env var: it never reaches a browser.

**Disclaimer:** PulseAlpha is a screening tool for research and education. It is not investment advice and not a SEBI-registered research service. If you plan to share its picks publicly in India, check SEBI's Research Analyst and finfluencer rules first.
