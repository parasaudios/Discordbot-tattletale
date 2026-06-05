import Anthropic from '@anthropic-ai/sdk';

// Lazily created so the bot still runs (with AI disabled) when no key is set.
let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  return client;
}

const MODEL = 'claude-haiku-4-5-20251001';

// The classification instructions. Kept stable so prompt caching applies on
// every call (the system prefix is identical, so repeat calls are far cheaper).
const SYSTEM_PROMPT = `You are a Discord moderation classifier. You are given a single chat message and must decide whether it is likely a scam, phishing attempt, harassment, or other clear rule-breaking abuse.

Respond with ONLY a compact JSON object, no markdown, no extra text:
{"flag": boolean, "category": string, "confidence": number, "reason": string}

- "flag": true only if the message is likely abusive/scammy/harmful.
- "category": one of "scam", "phishing", "harassment", "spam", "other", or "none".
- "confidence": 0.0 to 1.0.
- "reason": a brief (max 15 word) explanation.

Be precise. Casual mention of gifts, money, or links is NOT automatically a scam — judge intent and context. Do not flag normal conversation.`;

// Cheap pre-filter: only spend an API call on messages that show at least one
// scam/abuse signal. Most chatter never reaches the model, keeping costs tiny.
const PREFILTER = /(https?:\/\/|discord\.gg\/|nitro|free\s|airdrop|giveaway|claim|wallet|seed phrase|crypto|\bdm me\b|click here|verify your|account will be|@everyone|@here)/i;

export function shouldScreen(content) {
  if (!content || content.length < 4) return false;
  return PREFILTER.test(content);
}

// Short-lived result cache keyed on message content. A scammer pasting the same
// link/text repeatedly (exactly the abuse AI is meant to catch) would otherwise
// cost one API call per copy; here repeats are served from memory for free.
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX = 500;             // bounded so memory can't grow unbounded
const cache = new Map();           // key -> { at: number, result }

function cacheKey(content) {
  return content.trim().slice(0, 500);
}

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  // Re-insert to mark as most-recently-used (Map preserves insertion order).
  cache.delete(key);
  cache.set(key, entry);
  return entry.result;
}

function cacheSet(key, result) {
  cache.set(key, { at: Date.now(), result });
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value; // evict least-recently-used
    cache.delete(oldest);
  }
}

// Returns { flag, category, confidence, reason } or null on any error/no-key.
export async function classifyMessage(content) {
  const c = getClient();
  if (!c) return null;

  const key = cacheKey(content);
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  try {
    const response = await c.messages.create({
      model: MODEL,
      max_tokens: 150,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' }, // cache the stable prefix
        },
      ],
      messages: [{ role: 'user', content: `Message: ${content}` }],
    });
    const text = response.content?.[0]?.text?.trim();
    if (!text) return null;
    const cleaned = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.flag !== 'boolean') return null;
    cacheSet(key, parsed);
    return parsed;
  } catch (err) {
    console.error('AI classify error:', err.message);
    return null; // fail open: never block the bot on an API hiccup
  }
}
