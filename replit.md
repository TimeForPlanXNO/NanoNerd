# XNO Guide — Nano Cryptocurrency Chat

## Overview
A simple AI-powered chat application entirely focused on Nano (XNO) cryptocurrency. The AI assistant answers any question but always steers the conversation back to Nano. It uses streaming responses and asks a follow-up question about Nano after every reply.

## Architecture
- **Runtime**: Node.js (CommonJS)
- **Server**: Express.js on port 5000
- **AI**: OpenAI via Replit AI Integrations (no API key needed, billed to Replit credits)
- **Model**: gpt-5.1 with streaming
- **Frontend**: Vanilla HTML/CSS/JS served as static files from `public/`

## Key Files
- `server.js` — Express server with `/api/chat` streaming SSE endpoint
- `public/index.html` — Full chat UI with welcome screen and suggested questions
- `package.json` — Dependencies and start script

## Running
```bash
npm start
```
Starts the server on port 5000.

## AI Behavior
The system prompt configures the AI as "XNO Guide":
- Only discusses Nano (XNO) and related topics
- Bridges any off-topic question back to Nano
- Ends every response with one follow-up question about Nano

## Environment Variables
- `AI_INTEGRATIONS_OPENAI_API_KEY` — Auto-set by Replit AI Integrations
- `AI_INTEGRATIONS_OPENAI_BASE_URL` — Auto-set by Replit AI Integrations
