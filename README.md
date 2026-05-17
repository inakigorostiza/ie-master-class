# IE Business School — Programs Chatbot

A landing page that markets the 23 IE Business School master programs and embeds an admissions-style chatbot grounded in the local `knowledge_base/`.

- **Frontend:** static HTML/CSS/JS in [public/](public/)
- **Backend:** tiny Node/Express server ([server.js](server.js))
- **LLM:** Anthropic Claude via the official SDK, full KB stuffed in the system prompt with prompt caching
- **Retrieval:** none — KB is ~50–60K tokens, sent once and cached

## Run

```bash
npm install
cp .env.example .env        # then add your ANTHROPIC_API_KEY
npm start
```

Then open http://localhost:3000.

For auto-reload during development:

```bash
npm run dev
```

## Project layout

```
.
├── server.js               Express + /api/programs + /api/chat (SSE)
├── public/
│   ├── index.html          Landing page (hero + program grid + chat widget)
│   ├── styles.css          IE-inspired styles
│   ├── app.js              Renders the program grid
│   └── chat.js             Chat widget logic + streaming
└── knowledge_base/         23 IE master programs (markdown + jsonl)
```

## What the chatbot can answer

The system prompt grounds Claude in the local KB only. Try:

- "What's the duration of the Master in Digital Marketing?"
- "Which programs have a dual-degree option with the IMBA?"
- "Compare the standalone Master in Customer Experience & Innovation with the dual-IMBA version."
- "I have 4 years of work experience — which executive program fits me?"

If the answer isn't in the KB, the bot will say so and point you to ie.edu.
