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
