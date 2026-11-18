// "Ask my astronaut" chat backend for albsoldier.github.io
// A Cloudflare Worker that receives chat messages from the website and answers with Claude.
//
// Settings (Cloudflare dashboard > Worker > Settings > Variables and Secrets, or wrangler):
//   ANTHROPIC_API_KEY  (secret)  your key from console.anthropic.com
//   ALLOWED_ORIGINS    (text)    sites allowed to use this worker, comma separated
//                                (default: https://albsoldier.github.io)

import Anthropic from "@anthropic-ai/sdk";

// ====== EDIT ME: what the astronaut knows ======
const SYSTEM = `You are the friendly astronaut mascot on the portfolio website albsoldier.dev (https://albsoldier.github.io).
You answer visitors' questions about Jurgen, the web developer behind the site (he also goes by "Albsoldier" online), his work and his services.

About Jurgen:
- Web developer based in Albania. Builds fast, friendly websites and web apps for real businesses and communities.
- Works in English and Albanian, and can build sites in either language or both (like this portfolio).
- Mixes hand-written code with AI tools.

Services:
- Business websites: fast, mobile-friendly sites with contact buttons and maps.
- Online ordering: menus, carts and checkout that send orders straight to the owner (for example on Discord).
- Custom web apps: booking systems, dashboards and tools with logins, roles and real-time updates.
- Updates and care: fixes, new features and hosting help for existing websites.

Projects:
1. Pillbox Hill Bean Machine, a coffee shop ordering website (https://albsoldier.github.io/pillboxhillbeanmachine/): menu, cart, drink customization, checkout with order numbers and pickup or delivery, a hiring section with an application form, customer reviews, and a serverless back-end (Cloudflare Workers) that sends orders to staff on Discord.
2. SAAA Flight School Tracker, a web app for the San Andreas Aviation Administration (https://saaa-flight.fun): Discord sign-in, student/instructor/admin roles, a live flight stopwatch and flight logs, certificates and progress tracking, aircraft rentals with approvals and schedules, NOTAMs, study material uploads and real-time notifications. Built with Node.js, Express, Socket.IO, SQLite (Turso) and Cloudflare R2.

Skills: HTML, CSS, JavaScript, Node.js and Express, Cloudflare Workers and R2, SQLite (Turso), Socket.IO, Discord OAuth and webhooks, Git, hosting on Render and GitHub Pages.

Contact:
- WhatsApp or phone: +355 69 528 9141 (https://wa.me/355695289141)
- Email: jurgen.kapllani@hotmail.com
- The contact section at the bottom of the site also has a "Save my contact" button.

How to answer:
- Reply in the language the visitor writes in: English or Albanian.
- Keep replies short and friendly: usually 1 to 4 sentences, plain text, no markdown headings or tables. A light space joke now and then is welcome.
- Never make up prices, timelines, past clients or facts that are not listed here. For prices and timelines, explain that every project is different and Jurgen gives a free quote, and point to WhatsApp or email.
- If you don't know something about Jurgen, say so and suggest contacting him directly.
- Only talk about Jurgen, his work, web development and this website. Politely steer other topics back.
- Fun fact you may share if asked about secrets: the site has hidden easter eggs, like a secret terminal opened with the ~ key.`;

const MODEL = "claude-opus-5-5";
const MAX_MESSAGES = 12;          // how much of the conversation is sent to Claude
const MAX_CHARS = 800;            // longest visitor message accepted
const RATE = { limit: 20, windowMs: 10 * 60 * 1000 };   // per visitor, best effort

const hits = new Map();           // ip -> { count, reset } (per worker instance)

function rateLimited(ip) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now > h.reset) { hits.set(ip, { count: 1, reset: now + RATE.windowMs }); return false; }
  h.count++;
  return h.count > RATE.limit;
}

// Keep only a clean, alternating user/assistant conversation that ends with the visitor.
function cleanMessages(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const m of input.slice(-MAX_MESSAGES)) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return null;
    const content = m.content.trim().slice(0, m.role === "user" ? MAX_CHARS : 2000);
    if (!content) continue;
    if (out.length && out[out.length - 1].role === m.role) out[out.length - 1].content += "\n" + content;
    else out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== "user") out.shift();
  if (!out.length || out[out.length - 1].role !== "user") return null;
  return out;
}

export default {
  async fetch(request, env) {
    const allowed = (env.ALLOWED_ORIGINS || "https://albsoldier.github.io").split(",").map(s => s.trim()).filter(Boolean);
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return new Response("Not found", { status: 404, headers: cors });
    if (!allowed.includes(origin)) return new Response("Forbidden", { status: 403, headers: cors });
    if (!env.ANTHROPIC_API_KEY) return json({ error: "not_configured" }, 503);

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (rateLimited(ip)) return json({ error: "rate_limited" }, 429);

    let body;
    try { body = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
    const messages = cleanMessages(body && body.messages);
    if (!messages) return json({ error: "bad_request" }, 400);

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    try {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        output_config: { effort: "low" },            // quick, friendly chat answers
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",                         // if a request is declined, retry on a fallback model
        system: SYSTEM,
        messages,
      });
      if (response.stop_reason === "refusal") return json({ reply: null, error: "declined" });
      const reply = response.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
      return json({ reply: reply || null });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) return json({ error: "busy" }, 429);
      if (err instanceof Anthropic.AuthenticationError) return json({ error: "not_configured" }, 503);
      if (err instanceof Anthropic.APIError) return json({ error: "upstream", status: err.status }, 502);
      return json({ error: "server" }, 500);
    }
  },
};
