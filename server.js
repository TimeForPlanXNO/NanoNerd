const express = require("express");
const path = require("path");
const OpenAI = require("openai").default;

const app = express();
const PORT = 5000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
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
      model: "gpt-5.1",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      stream: true,
      max_completion_tokens: 8192,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    console.error("OpenAI error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to get AI response" });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`);
      res.end();
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Nano Chat server running on port ${PORT}`);
});
