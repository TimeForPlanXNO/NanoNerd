const express = require("express");
const path    = require("path");
const https   = require("https");
const http    = require("http");
const zlib    = require("zlib");
const { URL } = require("url");
const OpenAI  = require("openai").default;

const app  = express();
const PORT = 5000;

app.use(express.json());
/* Disable caching for HTML so browsers always get the latest JS */
app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, "public")));

/* ── OpenAI ── */
const openai = new OpenAI({
  apiKey:   process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL:  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const SYSTEM_PROMPT = `You are NanoNerd 🧠 — an enthusiastic and deeply knowledgeable AI assistant dedicated exclusively to Nano (XNO) cryptocurrency.

YOUR CORE RULES:
1. You ONLY talk about Nano (XNO) and topics that connect to it.
2. Every single message you send must be related to Nano (XNO) in some way.
3. If a user asks about something unrelated (e.g., Bitcoin, cooking, sports), you acknowledge their question and IMMEDIATELY bridge it back to Nano with a compelling connection.
4. After every response, you ask ONE thought-provoking follow-up question to keep the conversation going — always about Nano.
5. You are friendly, curious, and passionate about Nano.

NANO KNOWLEDGE YOU DRAW FROM:
- Nano is a feeless, instant, eco-friendly cryptocurrency using a block-lattice DAG structure
- Each account has its own blockchain; consensus uses Open Representative Voting (ORV)
- Ticker symbol: XNO, formerly NANO
- Founded by Colin LeMahieu in 2015, originally called RaiBlocks (XRB)
- No mining, no transaction fees, near-zero energy consumption
- Final settlement in under 1 second in most cases
- Fixed supply: 133,248,289 XNO
- Use cases: micropayments, remittances, machine-to-machine payments, everyday digital cash
- Wallets: Natrium, Nault, Cake Wallet
- Exchanges: Binance, Kraken, and others

BRIDGING EXAMPLES:
- "What's a good recipe?" → "Speaking of ingredients combining perfectly — Nano combines speed, zero fees, and eco-friendliness into one cryptocurrency. What do you think makes Nano's feeless model so rare compared to other blockchains?"
- "Tell me about Bitcoin" → "Bitcoin is the original crypto, but Nano takes the concept further — no fees, instant transactions, and a tiny carbon footprint. Have you compared Nano's block-lattice to Bitcoin's blockchain before?"

Always end with exactly one question about Nano.`;

/* ═══════════════════════════════════════════════════
   PATH-BASED REVERSE PROXY
   All iframe traffic flows through our server so
   X-Frame-Options / CSP headers can be stripped.
═══════════════════════════════════════════════════ */
const PROXY_SITES = {
  "nano-org": { host: "nano.org",      target: "https://nano.org"      },
  "nano-gpt": { host: "nano-gpt.com",  target: "https://nano-gpt.com"  },
};

/* Rewrite HTML: root-relative and same-domain URLs → proxy-prefixed paths */
function rewriteHtml(html, site, proxyBase) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /* root-relative  href="/…"  src="/…"  action="/…" etc. */
  html = html
    .replace(/((?:href|src|action|srcset|data-src|poster|content)\s*=\s*")(\/(?!\/))/gi, `$1${proxyBase}/`)
    .replace(/((?:href|src|action|srcset|data-src|poster|content)\s*=\s*')(\/(?!\/))/gi, `$1${proxyBase}/`);

  /* absolute same-origin  href="https://nano-gpt.com/…" */
  const originRe = new RegExp(`((?:href|src|action|srcset|data-src)\\s*=\\s*["'])${esc(site.target)}(/|["'])`, "gi");
  html = html.replace(originRe, (_, prefix, after) =>
    after === "/" ? `${prefix}${proxyBase}/` : `${prefix}${proxyBase}/"`
  );

  /* inline CSS  url("/…") */
  html = html.replace(/(url\(\s*["']?)(\/(?!\/))/gi, `$1${proxyBase}/`);

  return html;
}

/* Rewrite JS/JSON: root-relative string literals for known static paths */
function rewriteJs(js, proxyBase) {
  return js.replace(
    /(['"`])(\/(?:_app|_next|static|assets|fonts|images)\/[^'"`\s]*?)(['"`])/g,
    (_, q1, p, q2) => `${q1}${proxyBase}${p}${q2}`
  );
}

/* Intercept script injected into every proxied HTML page */
function makeInterceptScript(site, proxyBase) {
  return `<script data-proxy="1">
(function(){
  var base="${proxyBase}", host="${site.host}";
  function rw(href){try{var u=new URL(href);if(u.hostname===host||u.hostname==="www."+host)return base+u.pathname+u.search+u.hash;}catch(e){}return null;}
  document.addEventListener("click",function(e){
    var a=e.target.closest("a[href]");if(!a)return;
    var r=rw(a.href);if(r){e.preventDefault();window.location.href=r;}
  },true);
})();
</script>`;
}

/* Core fetch-and-respond function */
function proxyRequest(site, subPath, proxyBase, res) {
  const targetUrl = new URL(site.target + (subPath || "/"));
  const proto = targetUrl.protocol === "https:" ? https : http;

  const reqOptions = {
    hostname: targetUrl.hostname,
    path:     targetUrl.pathname + targetUrl.search,
    method:   "GET",
    headers: {
      "User-Agent":       "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Accept":           "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language":  "en-US,en;q=0.5",
      "Accept-Encoding":  "gzip, deflate, br",
    },
  };

  proto.get(reqOptions, (upstream) => {
    /* One-level redirect */
    if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
      try {
        const loc = new URL(upstream.headers.location, site.target + subPath);
        if (loc.hostname === site.host || loc.hostname === "www." + site.host) {
          return res.redirect(proxyBase + loc.pathname + loc.search);
        }
      } catch {}
      return res.redirect(upstream.headers.location);
    }

    /* Strip frame-busting headers */
    delete upstream.headers["x-frame-options"];
    delete upstream.headers["content-security-policy"];
    delete upstream.headers["content-security-policy-report-only"];

    const enc = upstream.headers["content-encoding"] || "";
    const ct  = upstream.headers["content-type"]     || "";

    delete upstream.headers["content-encoding"];
    delete upstream.headers["content-length"];

    res.status(upstream.statusCode);
    Object.entries(upstream.headers).forEach(([k, v]) => { try { res.setHeader(k, v); } catch {} });

    const isHtml = ct.includes("text/html");
    const isJs   = ct.includes("javascript") || ct.includes("json");

    if (isHtml || isJs) {
      let stream = upstream;
      if (enc === "gzip")    stream = upstream.pipe(zlib.createGunzip());
      else if (enc === "deflate") stream = upstream.pipe(zlib.createInflate());
      else if (enc === "br") stream = upstream.pipe(zlib.createBrotliDecompress());

      const chunks = [];
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", () => {
        let text = Buffer.concat(chunks).toString("utf8");

        if (isHtml) {
          text = rewriteHtml(text, site, proxyBase);
          const intercept = makeInterceptScript(site, proxyBase);
          const base      = `<base href="${proxyBase}/">`;
          text = text.replace(/<head([^>]*)>/i, `<head$1>${base}${intercept}`);
          if (!/<head/i.test(text)) text = base + intercept + text;
          res.setHeader("content-type", "text/html; charset=utf-8");
        } else {
          text = rewriteJs(text, proxyBase);
        }

        res.send(text);
      });
      stream.on("error", () => { if (!res.headersSent) res.status(502).end(); });
    } else {
      upstream.pipe(res);
    }
  }).on("error", (err) => {
    if (!res.headersSent) res.status(502).send("Proxy error: " + err.message);
  });
}

/* Mount proxy routes for each site */
Object.entries(PROXY_SITES).forEach(([key, site]) => {
  const proxyBase = `/proxy/${key}`;
  const handler = (req, res) => {
    const subPath = req.path.slice(proxyBase.length) || "/";
    const qs = (req.url.match(/\?.*$/) || [''])[0];
    proxyRequest(site, (subPath || "/") + qs, proxyBase, res);
  };
  app.get(proxyBase, handler);
  app.get(`${proxyBase}/`, handler);
  app.get(`${proxyBase}/*path`, handler);
});

/* ── Nano Live Stats (background poller) ── */
let _nanoStats = { tps: null, cemented: 0, blockCount: 0, priceUsd: 0, change24h: 0, marketCap: 0, volume24h: 0, lastUpdated: 0, lastFinality: null, lastFinalityAt: 0 };
let _prevCemented = null, _prevCementedTime = null, _lastPriceUpdate = 0, _lastNewBlockTime = 0;

function postJson(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'User-Agent': 'NanoNerd/1.0' }
    }, res => {
      const enc = res.headers['content-encoding'] || '';
      let stream = res;
      if (enc === 'gzip')    stream = res.pipe(zlib.createGunzip());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      const chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function getJson(hostname, path) {
  return new Promise((resolve, reject) => {
    https.get({ hostname, path, headers: { 'User-Agent': 'NanoNerd/1.0', 'Accept': 'application/json' } }, res => {
      const enc = res.headers['content-encoding'] || '';
      let stream = res;
      if (enc === 'gzip')    stream = res.pipe(zlib.createGunzip());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      const chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

/* Try multiple RPC nodes in order — return the first that succeeds */
async function fetchBlockCount() {
  const nodes = [
    ['nanoslo.0x.no',         '/proxy'    ],
    ['mynano.ninja',          '/api/node' ],
    ['node.nano.community',   '/'         ],
  ];
  for (const [hostname, path] of nodes) {
    try {
      const d = await postJson(hostname, path, { action: 'block_count' });
      if (d && (d.cemented || d.count)) return d;
    } catch {}
  }
  throw new Error('all RPC nodes failed');
}

async function updateNanoStats() {
  try {
    const blockData = await fetchBlockCount();
    const now = Date.now();
    const cemented = parseInt(blockData.cemented) || 0;
    if (_prevCemented !== null && _prevCementedTime !== null) {
      const newBlocks = cemented - _prevCemented;
      const dt = (now - _prevCementedTime) / 1000;
      /* Only update TPS and finality when a new block was actually confirmed */
      if (dt > 0 && newBlocks > 0) {
        _nanoStats.tps            = newBlocks / dt;
        _nanoStats.lastFinality   = dt / newBlocks;  /* seconds per block */
        _nanoStats.lastFinalityAt = now;
        _lastNewBlockTime         = now;
      } else if (_lastNewBlockTime > 0 && (now - _lastNewBlockTime) > 5000) {
        _nanoStats.tps = 0;                          /* no new blocks for 5 s → show 0 */
      }
    }
    _prevCemented = cemented;
    _prevCementedTime = now;
    _nanoStats.cemented   = cemented;
    _nanoStats.blockCount = parseInt(blockData.count) || 0;
    _nanoStats.lastUpdated = now;
  } catch(e) { /* silent */ }

  /* Price: refresh every 90 seconds */
  if (Date.now() - _lastPriceUpdate > 90000) {
    try {
      const p = await getJson('api.coingecko.com', '/api/v3/simple/price?ids=nano&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true');
      _nanoStats.priceUsd  = p?.nano?.usd            || 0;
      _nanoStats.change24h = p?.nano?.usd_24h_change  || 0;
      _nanoStats.marketCap = p?.nano?.usd_market_cap  || 0;
      _nanoStats.volume24h = p?.nano?.usd_24h_vol     || 0;
      _lastPriceUpdate = Date.now();
    } catch(e) { /* silent */ }
  }
}

updateNanoStats();
setInterval(updateNanoStats, 2000);

app.get('/api/nano-stats', (_req, res) => {
  /* Compute relay CPS from rolling 10-second window of confirmed TXs */
  const now = Date.now();
  while (_relayTimes.length && _relayTimes[0] < now - 10000) _relayTimes.shift();
  const relayCps = Math.round(_relayTimes.length / 10 * 10) / 10;
  res.json({
    ..._nanoStats,
    relayCps,          /* real-time conf/s from live WS feeds (deduped) */
    nodesOnline: _nodesOnline,
    totalRelayed: _totalRelayed,
  });
});

/* ── Nano Representatives ── */
app.get("/api/nano-reps", (req, res) => {
  https.get({
    hostname: "nanoticker.org",
    path: "/api/representatives",
    headers: { "User-Agent": "NanoNerd/1.0", "Accept": "application/json" }
  }, (upstream) => {
    const chunks = [];
    let stream = upstream;
    const enc = upstream.headers["content-encoding"] || "";
    if (enc === "gzip")    stream = upstream.pipe(zlib.createGunzip());
    else if (enc === "br") stream = upstream.pipe(zlib.createBrotliDecompress());
    stream.on("data", c => chunks.push(c));
    stream.on("end", () => {
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const reps = (data.sortedRepresentatives || []).map(r => ({
          account:         r.account,
          alias:           r.alias || null,
          weight:          parseFloat(r.weight) || 0,
          uptimePercentage: r.uptimePercentage ?? 100,
          version:         r.fullVersion || null,
          totalScore:      r.totalScore || 0,
        }));
        res.json({ reps });
      } catch (e) {
        res.status(502).json({ error: "Parse error" });
      }
    });
    stream.on("error", () => res.status(502).json({ error: "Stream error" }));
  }).on("error", err => res.status(502).json({ error: err.message }));
});

/* ── Nano Wallets (scraped from hub.nano.org/wallets) ── */
const _WALLET_FALLBACK = [
  { name: 'Nault',                url: 'https://nault.cc/' },
  { name: 'Natrium',              url: 'https://natrium.io/' },
  { name: 'Nautilus',             url: 'https://nautilus.io' },
  { name: 'WeNano',               url: 'https://wenano.net/' },
  { name: 'NanChat',              url: 'https://nanchat.com/' },
  { name: 'Stack Wallet',         url: 'https://stackwallet.com/' },
  { name: 'Cake Wallet',          url: 'https://cakewallet.com' },
  { name: 'Arctic Wallet',        url: 'https://arcticwallet.io/' },
  { name: 'NOW Wallet',           url: 'https://walletnow.app/' },
  { name: 'Ledger Hardware Wallet', url: 'https://www.ledger.com/' },
  { name: 'Nano Paper Wallet',    url: 'https://nanopaperwallet.com/' },
  { name: 'Xnap',                 url: 'https://xnap.xyz/' },
  { name: 'TrustWallet',          url: 'https://trustwallet.com/' },
];

app.get('/api/wallets', (_req, res) => {
  https.get({
    hostname: 'hub.nano.org',
    path: '/wallets',
    headers: { 'User-Agent': 'NanoNerd/1.0', 'Accept': 'text/html' }
  }, (upstream) => {
    const chunks = [];
    let stream = upstream;
    const enc = upstream.headers['content-encoding'] || '';
    if (enc === 'gzip')    stream = upstream.pipe(zlib.createGunzip());
    else if (enc === 'br') stream = upstream.pipe(zlib.createBrotliDecompress());
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => {
      try {
        const html = Buffer.concat(chunks).toString('utf8');
        /* Extract name/url pairs from embedded SvelteKit JSON blobs */
        const wallets = [];
        const nameRe  = /"name":"([^"]+)"/g;
        const urlRe   = /"url":"(https?:\/\/[^"]+)"/g;
        const names = [...html.matchAll(nameRe)].map(m => m[1]);
        const urls  = [...html.matchAll(urlRe)].map(m => m[1]);
        const len   = Math.min(names.length, urls.length);
        for (let i = 0; i < len; i++) wallets.push({ name: names[i], url: urls[i] });
        res.json(wallets.length ? wallets : _WALLET_FALLBACK);
      } catch {
        res.json(_WALLET_FALLBACK);
      }
    });
    stream.on('error', () => res.json(_WALLET_FALLBACK));
  }).on('error', () => res.json(_WALLET_FALLBACK));
});

/* ── Nano Faucets (scraped from hub.nano.org/faucets) ── */
const _FAUCET_FALLBACK = [
  { name: 'NanoDrop',    url: 'https://nanodrop.io/' },
  { name: 'Nano Faucet', url: 'https://nano-faucet.org/' },
  { name: 'Free Nano',   url: 'https://freenano.win/' },
  { name: 'Nano Button', url: 'https://nanobutton.io/' },
];

app.get('/api/faucets', (_req, res) => {
  https.get({
    hostname: 'hub.nano.org',
    path: '/faucets',
    headers: { 'User-Agent': 'NanoNerd/1.0', 'Accept': 'text/html' }
  }, (upstream) => {
    const chunks = [];
    let stream = upstream;
    const enc = upstream.headers['content-encoding'] || '';
    if (enc === 'gzip')    stream = upstream.pipe(zlib.createGunzip());
    else if (enc === 'br') stream = upstream.pipe(zlib.createBrotliDecompress());
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => {
      try {
        const html = Buffer.concat(chunks).toString('utf8');
        const faucets = [];
        const nameRe  = /"name":"([^"]+)"/g;
        const urlRe   = /"url":"(https?:\/\/[^"]+)"/g;
        const names = [...html.matchAll(nameRe)].map(m => m[1]);
        const urls  = [...html.matchAll(urlRe)].map(m => m[1]);
        const len   = Math.min(names.length, urls.length);
        for (let i = 0; i < len; i++) faucets.push({ name: names[i], url: urls[i] });
        res.json(faucets.length ? faucets : _FAUCET_FALLBACK);
      } catch {
        res.json(_FAUCET_FALLBACK);
      }
    });
    stream.on('error', () => res.json(_FAUCET_FALLBACK));
  }).on('error', () => res.json(_FAUCET_FALLBACK));
});

/* ── Translate suggestions ── */
app.post("/api/translate-suggestions", async (req, res) => {
  const { lang, suggestions } = req.body;
  if (!lang || !Array.isArray(suggestions)) {
    return res.status(400).json({ error: "lang and suggestions required" });
  }
  const safeLang = typeof lang === 'string' ? lang.slice(0, 60).replace(/[^\w\s\-]/g, '') : 'English';
  if (safeLang === 'English') return res.json({ suggestions });
  const safeSuggestions = suggestions.slice(0, 20).map(s => String(s).slice(0, 200));
  try {
    const prompt = `Translate each of the following questions about Nano (XNO) cryptocurrency into ${safeLang}. Return ONLY a JSON array of exactly ${safeSuggestions.length} translated strings, preserving the original meaning. No explanations.\n\n${JSON.stringify(safeSuggestions)}`;
    const completion = await openai.chat.completions.create({
      model: "gpt-5.1",
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 512,
    });
    const raw = completion.choices[0]?.message?.content?.trim() || '[]';
    const match = raw.match(/\[[\s\S]*\]/);
    const translated = match ? JSON.parse(match[0]) : safeSuggestions;
    res.json({ suggestions: translated });
  } catch (e) {
    console.error("translate-suggestions error:", e);
    res.status(500).json({ error: "Translation failed" });
  }
});

/* ── Chat streaming ── */
app.post("/api/chat", async (req, res) => {
  const { messages, lang } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Messages array is required" });
  }
  if (messages.length > 120) {
    return res.status(400).json({ error: "Too many messages" });
  }
  /* Sanitise: only keep known roles, cap content length */
  const ALLOWED_ROLES = new Set(['user', 'assistant']);
  const safeMessages = messages
    .filter(m => m && ALLOWED_ROLES.has(m.role) && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 8000) }));
  if (safeMessages.length === 0) {
    return res.status(400).json({ error: "No valid messages" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const safeLang = typeof lang === 'string' ? lang.slice(0, 60).replace(/[^\w\s\-]/g, '') : '';
  const langNote = (safeLang && safeLang !== 'English')
    ? `\n\nLANGUAGE RULE: You MUST respond exclusively in ${safeLang}. Every word of every reply must be in ${safeLang}, regardless of the language the user writes in.`
    : '';

  try {
    const stream = await openai.chat.completions.create({
      model:                "gpt-5.1",
      messages:             [{ role: "system", content: SYSTEM_PROMPT + langNote }, ...safeMessages],
      stream:               true,
      max_completion_tokens: 8192,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    console.error("OpenAI error:", error);
    if (!res.headersSent) res.status(500).json({ error: "Failed to get AI response" });
    else { res.write(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`); res.end(); }
  }
});

/* ── Translate existing chat messages to a new language ── */
app.post("/api/translate-messages", async (req, res) => {
  const { lang, messages } = req.body;
  if (!lang || !Array.isArray(messages)) {
    return res.status(400).json({ error: "lang and messages required" });
  }
  const safeLang = typeof lang === 'string' ? lang.slice(0, 60).replace(/[^\w\s\-]/g, '') : 'English';
  if (safeLang === 'English') return res.json({ messages });

  /* Only translate assistant messages (cap at 120, content at 8000 chars) */
  const indices = [], texts = [];
  messages.slice(0, 120).forEach((m, i) => {
    if (m && m.role === 'assistant' && m.content) {
      indices.push(i);
      texts.push(String(m.content).slice(0, 8000));
    }
  });
  if (!texts.length) return res.json({ messages });

  try {
    const prompt = `Translate the following AI assistant messages about Nano (XNO) cryptocurrency into ${safeLang}. Return ONLY a JSON array of exactly ${texts.length} translated strings in the same order. Preserve all markdown formatting (**bold**, *italic*, line breaks, bullet points). No extra explanations.\n\n${JSON.stringify(texts)}`;
    const completion = await openai.chat.completions.create({
      model: "gpt-5.1",
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 8192,
    });
    const raw  = completion.choices[0]?.message?.content?.trim() || '[]';
    const match = raw.match(/\[[\s\S]*\]/);
    const translated = match ? JSON.parse(match[0]) : texts;
    const result = messages.map((m, i) => {
      const pos = indices.indexOf(i);
      return pos >= 0 ? { ...m, content: translated[pos] ?? m.content } : m;
    });
    res.json({ messages: result });
  } catch (e) {
    console.error("translate-messages error:", e);
    res.status(500).json({ error: "Translation failed" });
  }
});

/* ══════════════════════════════════════════════════════════════
   NANO LIVE TX RELAY — 3-node redundant architecture
   All hashes are deduped via _seenHashes before broadcasting.
   • #1  wss://www.blocklattice.io/ws      (primary, all confirmations)
   • #2  wss://node.somenano.com/websocket  (secondary, all confirmations)
   • #3  wss://rainstorm.city/websocket     (rep-filtered confirmations)
   • Fallback: frontier polling every 15 s when WS feeds are quiet
══════════════════════════════════════════════════════════════ */
const _sseClients    = new Set();
let   _nanoWsAlive   = false;
let   _nodesOnline   = 0;          /* count of currently-connected WS feeds */
let   _lastTxTime    = 0;          /* epoch ms of last relayed TX */
let   _totalRelayed  = 0;
const _relayTimes    = [];         /* timestamps (ms) for rolling 10-s CPS window */
const _seenHashes    = new Set();  /* deduplication across all sources */
const _replayBuffer  = [];         /* last N hashes for new SSE clients */
const REPLAY_MAX     = 20;

function _broadcastTx(tx) {
  const payload = `data: ${JSON.stringify(tx)}\n\n`;
  for (const res of _sseClients) {
    try { res.write(payload); } catch { _sseClients.delete(res); }
  }
}

function _relayHash(hash, account) {
  const h = hash.toUpperCase();
  if (_seenHashes.has(h)) return;
  _seenHashes.add(h);
  /* Trim to prevent unbounded growth */
  if (_seenHashes.size > 10000) {
    const iter = _seenHashes.values();
    for (let i = 0; i < 2000; i++) _seenHashes.delete(iter.next().value);
  }
  const now = Date.now();
  _lastTxTime = now;
  _nanoWsAlive = true;
  _totalRelayed++;
  /* Rolling relay-time window — used to compute real-time CPS */
  _relayTimes.push(now);
  if (_relayTimes.length > 1000) _relayTimes.shift();
  if (_totalRelayed <= 5 || _totalRelayed % 50 === 0) {
    console.log(`[nano-relay] TX #${_totalRelayed}: ${h.slice(0, 16)}… clients=${_sseClients.size}`);
  }
  /* Replay buffer — new clients get the last N hashes immediately */
  const entry = { type: 'tx', hash: h, account: account || null };
  _replayBuffer.push(entry);
  if (_replayBuffer.length > REPLAY_MAX) _replayBuffer.shift();
  _broadcastTx(entry);
}

/* ── Helper: make a WS connection with keepalive pings ── */
function _makeWs(url, onOpen, onConfirmation) {
  let ws, pingTimer, retryTimer;
  function connect() {
    clearTimeout(retryTimer);
    clearInterval(pingTimer);
    console.log(`[nano-relay] Connecting → ${url}`);
    try {
      ws = new WebSocket(url);
      ws.addEventListener('open', () => {
        console.log(`[nano-relay] Connected ✓ ${url}`);
        _nodesOnline++;
        onOpen(ws);
        /* Server-side keepalive — prevents silent dead connections */
        pingTimer = setInterval(() => {
          try { ws.send(JSON.stringify({ action: 'ping' })); } catch {}
        }, 10000);
      });
      ws.addEventListener('message', evt => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.topic === 'confirmation' && msg.message?.hash) {
            onConfirmation(msg.message);
          }
        } catch {}
      });
      ws.addEventListener('error', err => {
        console.log(`[nano-relay] WS error ${url}:`, err?.message || 'unknown');
      });
      ws.addEventListener('close', () => {
        clearInterval(pingTimer);
        _nodesOnline = Math.max(0, _nodesOnline - 1);
        console.log(`[nano-relay] Closed ${url} — retry in 8 s`);
        retryTimer = setTimeout(connect, 8000);
      });
    } catch (e) {
      console.log(`[nano-relay] Create failed ${url}:`, e.message);
      retryTimer = setTimeout(connect, 10000);
    }
  }
  connect();
}

/* ── Primary: blocklattice.io — all confirmations (proven, fast feed) ── */
_makeWs(
  'wss://www.blocklattice.io/ws',
  ws => {
    ws.send(JSON.stringify({
      action: 'subscribe', topic: 'confirmation',
      options: { confirmation_type: 'all' },
    }));
    _nanoWsAlive = true;
    _broadcastTx({ type: 'status', connected: true, node: 'blocklattice' });
  },
  msg => _relayHash(msg.hash, msg.account),
);

/* ── Secondary: node.somenano.com — redundant all-confirmations feed ── */
_makeWs(
  'wss://node.somenano.com/websocket',
  ws => {
    ws.send(JSON.stringify({
      action: 'subscribe', topic: 'confirmation',
      options: { confirmation_type: 'all' },
    }));
    _nanoWsAlive = true;
  },
  msg => _relayHash(msg.hash, msg.account),
);

/* ── Secondary: rainstorm.city — account-filtered for online reps ── */
let _rainAccounts = [];
let _rainWsRef    = null;

function _connectRainWs() {
  if (_rainAccounts.length === 0) return;
  _makeWs(
    'wss://rainstorm.city/websocket',
    ws => {
      _rainWsRef = ws;
      ws.send(JSON.stringify({
        action: 'subscribe', topic: 'confirmation',
        options: { accounts: _rainAccounts.slice(0, 50), confirmation_type: 'all' },
      }));
      console.log(`[nano-relay] rainstorm watching ${Math.min(_rainAccounts.length, 50)} accounts`);
    },
    msg => _relayHash(msg.hash, msg.account),
  );
}

/* ── Fetch currently-online representatives every 5 minutes ── */
let _pollFrontiers = {};   /* account → last known confirmed_frontier */

async function _updateOnlineReps() {
  try {
    /* nanoslo proxy returns representatives as an array (not weight-keyed object) */
    const data = await postJson('nanoslo.0x.no', '/proxy', { action: 'representatives_online' });
    const reps  = Array.isArray(data.representatives)
      ? data.representatives
      : Object.keys(data.representatives || {});
    if (reps.length === 0) return;
    _rainAccounts = reps;
    /* Initialise frontier tracking for new accounts */
    for (const a of reps) { if (_pollFrontiers[a] === undefined) _pollFrontiers[a] = null; }
    console.log(`[nano-relay] Online reps refreshed: ${reps.length} — sample: ${reps[0]?.slice(0,20)}…`);
  } catch (e) {
    console.log('[nano-relay] representatives_online failed:', e.message);
  }
}

/* ── Pre-fill replay buffer using blocklattice.io/api/large-transactions ── */
/* Returns up to 2000+ recent confirmed TX hashes — no auth, no rate limit.  */
async function _prefillReplayBuffer() {
  let added = 0;
  try {
    const res = await fetch('https://blocklattice.io/api/large-transactions');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const txs = await res.json();
    if (!Array.isArray(txs)) throw new Error('unexpected response');
    for (const tx of txs) {
      if (!tx.hash || typeof tx.hash !== 'string') continue;
      _relayHash(tx.hash, tx.account || null);
      added++;
      if (_replayBuffer.length >= REPLAY_MAX) break;
    }
  } catch (e) {
    console.log('[nano-relay] prefill via large-transactions failed:', e.message);
  }
  console.log(`[nano-relay] Prefilled replay buffer: ${added} hashes from blocklattice.io`);
}

/* ── Frontier-polling fallback ── */
/* When WS has been silent for 15 s, poll account_info for online reps      */
/* and broadcast any newly-confirmed frontier hashes (real block hashes).    */
let _pollIdx = 0;
async function _frontierPollTick() {
  if (Date.now() - _lastTxTime < 15000) return; /* skip if WS recently active */
  if (_rainAccounts.length === 0) return;

  /* Poll up to 20 accounts per tick in a round-robin (covers all 77 reps ~every 60 s) */
  const batch = [];
  const batchSize = Math.min(20, _rainAccounts.length);
  for (let i = 0; i < batchSize; i++) {
    batch.push(_rainAccounts[_pollIdx % _rainAccounts.length]);
    _pollIdx++;
  }

  for (const account of batch) {
    try {
      const info = await postJson('nanoslo.0x.no', '/proxy', {
        action:            'account_info',
        account,
        include_confirmed: 'true',
      });
      const frontier = info.confirmed_frontier;
      if (!frontier || /^0+$/.test(frontier)) continue;
      if (_pollFrontiers[account] !== null && _pollFrontiers[account] !== frontier) {
        /* Account received a new confirmed block — relay its frontier hash */
        _relayHash(frontier, account);
        console.log(`[nano-relay] Poll new frontier: ${frontier.slice(0, 16)}… → ${account.slice(0, 20)}`);
      }
      _pollFrontiers[account] = frontier;
    } catch {}
  }
}

/* Bootstrap: prefill + reps in parallel → connect rainstorm → start polls */
(async () => {
  /* Prefill from blocklattice.io doesn't need reps — run both in parallel  */
  const [, ] = await Promise.all([
    _prefillReplayBuffer(),
    _updateOnlineReps(),
  ]);
  _connectRainWs();
  setInterval(_updateOnlineReps, 5 * 60 * 1000);    /* refresh reps every 5 min  */
  setInterval(_frontierPollTick, 15 * 1000);         /* frontier check every 15 s */
})();

/* SSE endpoint — browsers subscribe here to receive live TX events */
app.get('/api/nano-stream', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');   /* disable nginx buffering if any */
  res.flushHeaders();

  /* Send immediate status so the browser knows the connection is live */
  res.write(`data: ${JSON.stringify({ type: 'status', connected: _nanoWsAlive })}\n\n`);

  /* Replay the last N confirmed hashes — marked replay:true so the client
     can distinguish historical entries from live post-load confirmations  */
  for (const entry of _replayBuffer) {
    try { res.write(`data: ${JSON.stringify({ ...entry, replay: true })}\n\n`); } catch {}
  }

  _sseClients.add(res);
  console.log(`[nano-relay] SSE client connected (total: ${_sseClients.size}, replay=${_replayBuffer.length})`);

  /* Keep-alive ping every 20 s to prevent proxy timeouts */
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(ping); }
  }, 20000);

  req.on('close', () => {
    clearInterval(ping);
    _sseClients.delete(res);
    console.log(`[nano-relay] SSE client disconnected (total: ${_sseClients.size})`);
  });
});

/* REST endpoint — returns current replay buffer hashes for client fallback polling */
app.get('/api/nano-hashes', (req, res) => {
  res.json(_replayBuffer.map(e => e.hash));
});

app.listen(PORT, "0.0.0.0", () => console.log(`Nano Chat server running on port ${PORT}`));
