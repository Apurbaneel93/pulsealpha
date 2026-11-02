# PulseAlpha

A mobile-first PWA (with a full desktop layout) that surfaces 2–3 bullish NSE setups a day, each stamped with the exact IST time it was detected, a catalyst (with how fresh it is), and ATR-based levels: a buy zone, a stop-loss and two staggered targets.

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

## Live prices and charts

The scan decides *which* stocks qualify and is cached for 3 minutes. Prices are a separate, faster feed so the screen moves while the market is open:

- Every pick, the top 12 of the ranking and Nifty poll `/api/quotes` about every 20 seconds while NSE is open and the page is visible. Prices flash green or red on each tick, and a badge shows the exchange timestamp of the last trade ("Live · 11:31:05 AM"), so you always see how fresh a price really is.
- The server keeps one quote per symbol for 15 seconds (`unstable_cache`), so any number of viewers cost Yahoo about one request per symbol per window.
- Each pick shows where the live price sits against its plan: *In buy zone*, *x% above buy zone*, *Target reached* or *Below stop-loss*. The buy zone, target and stop-loss themselves stay as computed at detection.
- Each pick and each expanded ranking row has a real chart: 1D (1-minute bars on a fixed 09:15–15:30 IST axis, with the previous close), 5D, 1M, 3M, 6M and 1Y (daily, with 20- and 50-day averages), the buy zone, target and stop-loss, and a touch crosshair.
- If the scan comes back "stale" (the server is refreshing behind it), the app looks again after 9 seconds instead of leaving old data on screen.
- Prices come from Yahoo Finance's public feed, which is not the exchange's licensed tick feed that brokers like Groww stream. Expect seconds to a few minutes of lag, never a tick-by-tick display. The exchange timestamp on each quote tells you exactly how much.

## Layouts

- **Phone and tablet (under 1024 px):** one column with a bottom tab bar, exactly as designed for a phone.
- **Desktop (1024 px and up):** tabs move into the header, the picks sit beside a sticky sidebar (index moves, a Nifty 50 chart, and quick links to each pick), and the ranking becomes a sortable, filterable table whose rows open a chart.
- **Wide desktop (1280 px and up):** each pick card shows its chart and trade plan beside the research breakdown, which stays open.

Pinch-zoom is allowed (the old zoom lock was an accessibility problem). Text inputs are 16 px on touch devices so iOS doesn't auto-zoom them.

## Signal History

Stored only in the browser (`localStorage`, up to 300 rows). Each stock is logged once per IST day, at its first detection, so repeated scans don't flood the log. Demo and simulated rows are tagged and kept separate from live ones. Clearing site data or switching phones starts a fresh log.

---

## How a scan works

| Step | What happens | Where |
|---|---|---|
| 1. Global cues | Last-session change of `^GSPC`, `^IXIC`, `^NSEI` + Nifty vs its 20-EMA → regime score → Bullish / Neutral / Bearish | `lib/market-data.ts`, `lib/market-data-pure.ts` |
| 2. Indicators | ~90 liquid Nifty 200 names: 20-day SMA (the "20-DMA"), 20/50-EMA, Wilder RSI(14), Wilder ATR(14), relative volume, ATR % of price, coil ratio, 20-DMA extension — pure TypeScript | `lib/indicators.ts`, `lib/market-data-pure.ts` |
| 3. Momentum screen | All six must hold: price above the 20-DMA **but** no more than 4.5% above it; 52 ≤ RSI ≤ 65; yesterday's high−low ≤ 1.25 × ATR (the **coil ratio**); ATR ≥ 2.2% of price; volume ≥ 1.5 × its 20-day average. Every limit is inclusive and checked on the values shown on the card. | `lib/rules-engine.ts` (`HARD_FILTER`) |
| 4. Catalysts | Google News RSS per shortlisted symbol, kept only if published in the last 24 h, with timestamps | `lib/news.ts` |
| 5. Evaluation | Gemini gets, per survivor, only `rsi`, `rvol`, `atrPercent`, `coilRatio`, `sma20ExtensionPct` and the headlines (with IST timestamps), plus the market regime and the time the last session closed. The response schema's `symbol` is an **enum of the shortlist**, so it cannot name a stock that didn't pass. It returns a rank, conviction, catalyst category and freshness (`Unpriced Post-Market`, `Ongoing Multi-Day`, `Priced-In Recap`), a two-sentence thesis and an execution risk. A pick it flags `Priced-In Recap` is dropped. | `lib/gemini.ts`, `lib/gemini-prompt.ts` |
| 6. Levels | See below. All maths is in code. | `lib/levels.ts` |

### Levels and the Gap Guard

```
gap        = (price − previous close) ÷ ATR14
gap > 0.75 → WAIT_FOR_PULLBACK   base = previous close + 0.35 × ATR   (no VWAP feed, so the previous close is the anchor)
otherwise  → ACTIVE_BUY_ZONE     base = current price

buy zone = base ± 0.10 × ATR      stop-loss = base − 0.90 × ATR
Target 1 = base + 1.15 × ATR      "Book 60% & Trail SL to Breakeven"
Target 2 = base + 2.00 × ATR      "Book 40% or Trail 15m 9-EMA"
```

All levels are rounded to the ₹0.05 tick. Each card shows the Gap Guard status, both targets, and `ATR%`, `RVOL` and `Coil Ratio` pills. After the close, "price" is the last close and "previous close" the close before it, so the gap is that session's move measured in ATRs.

### Zero-hallucination guarantees

- **The model never sees an absolute price.** It receives only relative metrics (RSI, RVOL, ATR %, coil ratio, % above the 20-DMA) and headlines, so it cannot echo or distort a level.
- **Every number on a card comes from code.** AI output is limited to: which shortlisted symbols, their order, a conviction score, a category and freshness label, and prose.
- **AI prose that mentions ₹/Rs/INR or a "target of…" is discarded** and replaced with deterministic copy built from the real metrics.
- Hallucinated tickers, duplicates and malformed JSON are dropped; if Gemini fails, the rules engine ranks instead and the feed says so.
- If no stock passes the screen, the feed shows an empty state instead of forcing picks. The screen is strict, so expect some days with none.

### Fallbacks

- Yahoo unusable (index data fails, or < 35% of symbols load) and nothing cached → **simulated data**, flagged with an amber banner and a `Simulated` tag in history. Simulated data is never cached.
- During NSE hours the forming daily bar is excluded: indicators use completed sessions, the live price is used for the 20-DMA test and the levels.
- `gemini-2.5-flash` was retired on 16 Oct 2026, so the default model is `gemini-3.5-flash`. On a 404 the server retries once with `gemini-flash-latest`. Override via `GEMINI_MODEL` or the Model field in API Setup.

## API

| Route | Purpose |
|---|---|
| `GET /api/quotes?symbols=LT,INFY,^NSEI` | Public. Latest price, official previous close and exchange timestamp for up to 30 watchlist symbols, from a 15 s server cache. |
| `GET /api/chart?symbol=LT&range=1d` | Public. Price history: `1d` (1-minute bars), `5d` (5-minute), `1m` `3m` `6m` `1y` (daily, with EMA 20/50). Whitelisted symbols and ranges only. |
| `GET /api/scan` | The shared live scan (server key or rules engine), from cache when warm. Also the cron target. |
| `POST /api/scan` | **Owner only.** Body `{ mode?: "live" \| "demo", model?: string }`, optional header `x-gemini-key`. |
| `GET /api/verify` | **Owner only.** Accuracy report: filter funnel, raw sessions for cross-checking, ~9-month replay vs baseline. Cached per IST day. |
| `GET /api/verify/experiment` | **Owner only.** Strategy diagnostics: forward returns (vs the same-day average stock) for the screen, each check and indicator bin, and stop/target variants, all split into train and test periods. Cached per IST day. |
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
- `https://<preview-url>/api/verify` — today's filter funnel, the last 3 sessions and computed indicators for RELIANCE, HDFCBANK, ICICIBANK, INFY and TCS (compare with any chart), and a replay of the same screen and levels over roughly the last 9 months, with the 60/40 T1/T2 exits. It reports how often Target 1 and Target 2 are reached, stop-outs, breakeven exits, win rate, average return and profit factor for the app's top picks, for all signals, and for a no-filter baseline. Built once per IST day and cached for 6 hours.

Or run the same check on your own machine:

```bash
npm run verify                        # rules engine
GEMINI_API_KEY=... npm run verify     # ranked by Gemini, as on Vercel
```

How to read it: a winner books 60% at +1.15 ATR and the rest at breakeven or +2.00 ATR, and a loser costs 0.90 ATR, so if no runner ever reached Target 2 the plan would need Target 1 to be hit about 56.6% of the time to break even. Target 2 hits pull that down. **Average return per trade** and **profit factor** (> 1 means profitable) are the honest headline numbers, and they should beat the baseline, or the screen isn't adding anything. Daily bars hide the order of events inside a session, so the replay assumes the stop hits before Target 1 in the same session, applies the breakeven stop from the session after Target 1, and cannot replay the 15-minute 9-EMA trail. Costs aren't deducted; allow ~0.25% per round trip. The new screen has not been validated on real data in this repo: run it before trading on it.

### What the Jan–Oct 2026 history says (run on 3 Nov 2026, 93 liquid NSE stocks)

Found with `/api/verify` and `/api/verify/experiment`. Re-run them before relying on any of it; markets change.

- **No edge detected in the daily-bar screen.** Stocks passing all six checks (125 signals on 78 days) returned about the same as the average stock over the next 1–10 sessions (5-session excess −0.30%, t = −0.5; positive in the later period, negative in the earlier one). The plan lost money before costs (profit factor 0.84; the no-filter baseline 0.79) because the whole universe fell over the period; the card's levels are close to neutral on driftless synthetic prices (profit factor ≈ 1.1), so the structure itself is not the problem.
- **No stop or target arrangement fixes this.** Stops from 0.9 to 2.0 ATR, Target 1 from 1.0 to 1.5 ATR and a buy-the-open entry all stayed below profit factor 1 over the full period, on the screen and on every stock-day. Tuning them on ~100 trades would only fit noise.
- **RVOL ≥ 1.5 is the bottleneck and does not help.** Only about 15% of stock-days pass it, and stock-days with RVOL ≥ 1.5 had slightly *negative* 5-session excess (−0.10%, both periods). Low-volume days were slightly positive (+0.11%, t = 2.6, both periods).
- **Chasing a hot day loses; the Gap Guard is right.** A stock that closed more than 0.75 ATR above its previous close lagged by 0.25–0.33% over the next 3–5 sessions (t = −2.9, both periods). That held for both high- and low-volume days.
- **Small positives, all below costs:** a compact prior-day range (coil < 0.9) and a quiet day each add about +0.05 to +0.10% over five sessions. Round-trip costs are about 0.25%.
- **Not testable here:** the catalyst layer (post-market news, order wins, earnings). There are no historical headlines, so the part of the strategy most likely to carry an edge is untested. Paper-trade it before risking money.
- Fixed on the way: Yahoo can return the newest daily bar with `close = null` for hours after the bell, which made the whole scan one session old (now finalised from the last trade and flagged when a session is missing), and `LTIM.NS` is delisted (LTIMindtree trades as `LTM.NS`).

## Tests

```bash
npm test             # indicators vs the StockCharts RSI reference, ATR, snapshot ratios, IST formatting, regime, demo board,
                     # then the null-close session fix and the strategy diagnostics, then the strategy: the six-check screen, gap-guard levels, catalyst freshness, T1/T2 exits, the Gemini prompt
npm run test:live    # full live pipeline with Yahoo, Google News and Gemini mocked at the fetch layer
npm run build && npm run test:cache
                     # real `next start` + mocked upstream: counts upstream calls across requests and a restart
CACHE_TEST_REVALIDATE=1 npm run test:cache   # also waits out the 180 s window (~3 min)
npm run test:chart   # live price and chart logic: IST sessions, payloads, EMA alignment, quote maths, buy-zone and target status
npm run build && npm run test:quotes
                     # real `next start`: /api/quotes and /api/chart validation, shapes, cache behaviour, refresh after 15 s
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
