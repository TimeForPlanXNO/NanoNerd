# NanoNerd — Windows XP-style Nano Desktop SPA

## Overview
A Windows XP-style desktop single-page application featuring:
- **NanoNerd** — AI chat assistant (powered by OpenAI) focused on Nano (XNO)
- **nano.org** — Full replica of the nano.org website with hero, features, video section, use-cases carousel, ecosystem grid, and footer
- **NanoGPT** — Replica of nano-gpt.com with dark theme, gem logo image, search bar, and feature cards
- **Nano Hub** — Full replica of hub.nano.org with 12 category pages (Merchants, Wallets, Merchant Solutions, Trading, Developer Tools, Faucets, Gaming, Earn, AI, Charities, Other Services, Recently Added) — each with real items, tags, and "Visit Website" links

## Architecture
- **Runtime**: Node.js (CommonJS)
- **Server**: Express 5 on port 5000 (uses `/*path` wildcard syntax for path-to-regexp v8)
- **AI**: OpenAI via Replit AI Integrations (streaming SSE on `/api/chat`)
- **Model**: gpt-5.1 with streaming
- **Frontend**: Vanilla HTML/CSS/JS — single `public/index.html`

## Key Files
- `server.js` — Express server with `/api/chat` streaming endpoint
- `public/index.html` — Full desktop UI (all windows, CSS, JS in one file)
- `public/nanogpt-logo.png` — NanoGPT crystal gem logo (mix-blend-mode:screen)
- `public/wallpaper.jpg` — Windows XP-style desktop wallpaper
- `public/nano-logo.jpeg` — Fallback Nano logo
- `public/wallet-icon.jpeg` — Wallet launcher button icon (XNO wallet pouch image)

## Running
```bash
npm start
```
Starts the server on port 5000.

## Desktop Apps (Windows)
| App | Type | Description |
|-----|------|-------------|
| NanoNerd | Chat | AI streaming chat, Nano-focused |
| nano.org | Browser panel | Full site replica |
| NanoGPT | Browser panel | Full site replica with real gem logo |
| Nano Hub | Browser panel | 12-category ecosystem directory, all data real |
| Nano Videos & Memes | Folder | Media browser with wallpaper support (image/video) |
| Live XNO Matrix | Matrix canvas | Real-time digital rain of confirmed Nano TX hashes only (no fake hashes); click to open on nanolooker.com; "Wallpaper" button fills the desktop |

## Live XNO Matrix
- `_startMatrixRain(canvas, opts)` — shared engine used by both the app window and the wallpaper
- **One column = one TX** — each confirmed block hash is assigned to a randomly-chosen idle column
- Multiple TXs can fall simultaneously — each column shows a DIFFERENT hash
- If all columns are occupied, the most-progressed (oldest) column is replaced with the new TX
- Replay buffer entries (20 real confirmed hashes) are shown immediately on load — no waiting
- CW=13px / CH=15px so each hex character (0-9, A-F) is clearly legible as it falls
- Speed: 0.50–0.85 rows/frame, randomised per TX for visual variety
- Hover tooltip shows full TX hash + truncated account; click opens `https://blocklattice.io/block/{hash}`
- Dedup via `_seen` Set (bounded at 300, auto-cleared and repopulated from active columns)
- Wallpaper mode: `_applyMatrixWallpaper()` inserts `<canvas id="wp-matrix-canvas">` as desktop background
- `_stopMatrixWallpaper()` cleans up canvas + rAF + resize listener

## SSE Nano Relay (server.js)
Three-layer architecture ensuring real confirmed block hashes always reach browsers:

### Layer 1 — WebSocket (Primary): `wss://node.somenano.com/websocket`
- Subscribes to `confirmation_type: all`
- Server-side keepalive ping every 10 seconds

### Layer 2 — WebSocket (Secondary): `wss://rainstorm.city/websocket`
- Fetches online representatives via `nanoslo.0x.no/proxy` → `representatives_online`
- Subscribes to those 50 accounts with `options.accounts` filter (ACK confirmed)
- Server-side keepalive ping every 10 seconds

### Layer 3 — Frontier Polling Fallback
- Every 15 seconds, polls `account_info` for batches of 20 online representative accounts
- When `confirmed_frontier` changes for any account, broadcasts that hash as a TX event
- Activates when WS has been silent for >30 seconds
- **This layer is what currently delivers real hashes** (network TPS ~0.03-0.1)

### Replay Buffer
- `_replayBuffer[]` holds last 20 confirmed hashes (FIFO)
- New SSE clients receive replay buffer immediately on connect → matrix starts raining at once
- Deduplication via `_seenHashes` Set (trimmed at 10k entries)

## Nano Hub Navigation
- `hubNav(page)` global function toggles `.nh-visible` on `.nhub-view` divs
- Pages: `home`, `merchants`, `wallets`, `merchant-solutions`, `trading`, `developer-tools`, `faucets`, `gaming`, `earn`, `ai`, `charities`, `other-services`, `recently-added`
- Category icons loaded directly from `hub.nano.org/images/top-level-category-icons/`

## CSS Class Namespaces
- `.nhub-*` — Nano Hub panel
- `.ngpt-*` — NanoGPT panel
- `.np-*` — nano.org panel

## Environment Variables
- `AI_INTEGRATIONS_OPENAI_API_KEY` — Auto-set by Replit AI Integrations
- `AI_INTEGRATIONS_OPENAI_BASE_URL` — Auto-set by Replit AI Integrations

## Technical Notes
- Express 5 routing: wildcard routes use `/*path` (not `*` or `(.*)`), plus explicit base-path handlers
- Scroll uses `behavior:'instant'` to re-enable auto-scroll during streaming
- NanoGPT gem logo uses `mix-blend-mode:screen` to remove black background
- nano.org logo: inline SVG (XNO symbol, stroke-width:1.7, font-weight:300 NANO text, #7ab4e8 divider)
