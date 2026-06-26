// Pure text-matching, severity, and formatting helpers — no Discord or config
// dependencies, so they can be unit-tested in isolation (see test/matching.test.js).

// Normalize text to defeat common filter-evasion so the keyword list catches
// stretched/disguised spellings, not just the exact word:
//   • lowercase
//   • map common leetspeak to letters (p0op, p00p → poop; @→a, $→s, etc.)
//   • strip separators/punctuation/emoji (so "p o o p", "p.o.o.p", "p-o-o-p"
//     all collapse to "poop")
//   • squash runs of 3+ repeated characters down to 2 (so "pooooop" → "poop",
//     while a deliberate double letter like "poop" is preserved)
export function normalize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[@4]/g, 'a')
    .replace(/8/g, 'b')
    .replace(/[(<{]/g, 'c')
    .replace(/3/g, 'e')
    .replace(/9/g, 'g')
    .replace(/[1!|]/g, 'i')
    .replace(/0/g, 'o')
    .replace(/[5$]/g, 's')
    .replace(/7/g, 't')
    .replace(/2/g, 'z')
    .replace(/[^a-z0-9]+/g, '')
    .replace(/(.)\1{2,}/g, '$1$1');
}

// Returns the configured entry the message matches (after normalization), or null.
// Entries may be plain strings (aiTriggers) or { word, channelId, notify, wholeword }
// objects (good/bad words). Substring by default; `wholeword:true` matches only a
// standalone token, so "para" hits "para"/"P@r@" but not "paradise".
export function findMatch(content, entries) {
  if (!entries.length) return null;
  const haystack = normalize(content);
  let tokens = null; // normalized whitespace-split words (lazily computed for whole-word entries)
  for (const e of entries) {
    const word = typeof e === 'string' ? e : e.word;
    const needle = normalize(word);
    if (!needle) continue;
    if (typeof e === 'object' && e.wholeword) {
      if (tokens === null) tokens = (content || '').split(/\s+/).map(normalize);
      if (tokens.includes(needle)) return e;
    } else if (haystack && haystack.includes(needle)) {
      return e;
    }
  }
  return null;
}

// Pure severity decision:
//   high   = bad word AND Judge confirmed harmful
//   medium = Judge confirmed harmful with no bad word (caught via a Judge trigger)
//   low    = bad word not confirmed harmful, OR a Judge-trigger msg cleared as harmless
//   null   = nothing severity-worthy
export function decideTier({ badHit, aiHarmful, aiCleared }) {
  if (badHit && aiHarmful) return 'high';
  if (aiHarmful) return 'medium';
  if (badHit) return 'low';
  if (aiCleared) return 'low';
  return null;
}

// Parse one or more user/role mentions from a free-text `notify:` option into a
// normalized, de-duped mention string (e.g. "<@1> <@&2>"). Non-mention text is
// ignored. Returns null if no valid mentions are found.
export function parseMentions(input) {
  if (!input) return null;
  const out = [];
  const re = /<@!?(\d+)>|<@&(\d+)>/g;
  let m;
  while ((m = re.exec(input)) !== null) {
    out.push(m[1] ? `<@${m[1]}>` : `<@&${m[2]}>`);
  }
  const unique = [...new Set(out)];
  return unique.length ? unique.join(' ') : null;
}

export function truncate(text, max = 1024) {
  if (!text) return '*(no text content)*';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Severity tiers, their colour, and a label for the alert title.
export const TIERS = {
  high: { color: 0xED4245, label: '🔴 High alert — bad word + Judge confirmed harmful' },
  medium: { color: 0xE67E22, label: '🟠 Warning — Judge flagged as harmful' },
  low: { color: 0xF1C40F, label: '🟡 Notice — flagged but likely harmless' },
  good: { color: 0x57F287, label: '✅ Good word used (safe)' },
};
