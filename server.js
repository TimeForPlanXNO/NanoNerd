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
  app.get(`${proxyBase}/*path`, (req, res) => {
    const subPath = req.path.slice(proxyBase.length) || "/";
    proxyRequest(site, subPath + (req._parsedUrl.search || ""), proxyBase, res);
  });
});

/* ── Chat streaming ── */
app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Messages array is required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const stream = await openai.chat.completions.create({
      model:                "gpt-5.1",
      messages:             [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
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

app.listen(PORT, "0.0.0.0", () => console.log(`Nano Chat server running on port ${PORT}`));
