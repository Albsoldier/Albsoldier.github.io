# "Ask my astronaut" AI chat

The chat bubble on the portfolio works right away with built-in answers.
To make it answer with AI (Claude), deploy this small Cloudflare Worker and paste its address into `index.html`.

## 1. Get an Anthropic API key
1. Go to https://console.anthropic.com and sign in.
2. Add credit under **Billing**, and set a monthly **spend limit** there so a busy day can never surprise you.
3. Create a key under **API Keys** and copy it. Keep it secret: never put it in `index.html` or commit it.

## 2. Deploy the Worker (needs Node.js installed)
Run these in this `chat-worker` folder:

```bash
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy
```

`wrangler secret put` asks you to paste the key. `deploy` prints the Worker's address, like
`https://albsoldier-chat.<your-name>.workers.dev`.

## 3. Switch the website to AI answers
In `index.html`, search for `const CHAT_API = "";` and paste the address between the quotes:

```js
const CHAT_API = "https://albsoldier-chat.<your-name>.workers.dev";
```

Commit and push. That's it.

## Changing what the astronaut knows
Edit the `SYSTEM` text at the top of `src/index.js`, then run `npx wrangler deploy` again.

## Good to know
- Only `https://albsoldier.github.io` may use the Worker (`ALLOWED_ORIGINS` in `wrangler.toml`).
- Each visitor can send about 20 messages per 10 minutes.
- It uses Claude Opus 5.5 with low effort, so answers are quick. A typical answer costs roughly one US cent; the spend limit from step 1 caps the total.
- If the Worker is down or out of credit, the chat falls back to the built-in answers automatically.
