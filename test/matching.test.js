import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalize, findMatch, decideTier, parseMentions, truncate, TIERS,
} from '../src/matching.js';

test('normalize collapses leetspeak, stretching and separators', () => {
  assert.equal(normalize('P@r@'), 'para');
  assert.equal(normalize('p o o p'), 'poop');
  assert.equal(normalize('p.o.o.p'), 'poop');
  assert.equal(normalize('pooooop'), 'poop');
  assert.equal(normalize('Sc4M'), 'scam');
  assert.equal(normalize(''), '');
  assert.equal(normalize(null), '');
});

test('findMatch substring (default) — catches dodges, not unrelated words', () => {
  const bad = [{ word: 'poop' }];
  assert.ok(findMatch('you poophead', bad));
  assert.ok(findMatch('po0p', bad));
  assert.equal(findMatch('popular', bad), null);
  assert.equal(findMatch('', bad), null);
});

test('findMatch whole-word — para but not paradise', () => {
  const e = [{ word: 'para', wholeword: true }];
  assert.ok(findMatch('hey para how are you', e));
  assert.ok(findMatch('PaRa', e));
  assert.ok(findMatch('P@r@', e));
  assert.ok(findMatch('say para. ok', e)); // trailing punctuation stripped
  // note: 'para!' normalizes to 'parai' because '!' is leetspeak for 'i'
  assert.equal(findMatch('paradise', e), null);
  assert.equal(findMatch('paraphernalia', e), null);
  assert.equal(findMatch('preparation', e), null);
});

test('findMatch supports plain-string entries (Judge triggers)', () => {
  assert.equal(findMatch('grab some free NITRO now', ['nitro']), 'nitro');
  assert.equal(findMatch('nothing here', ['nitro']), null);
});

test('findMatch returns the matching entry object', () => {
  const entry = { word: 'slur', channelId: 'X' };
  assert.equal(findMatch('a slur', [entry]), entry);
});

test('decideTier covers every combination', () => {
  assert.equal(decideTier({ badHit: true, aiHarmful: true }), 'high');
  assert.equal(decideTier({ badHit: false, aiHarmful: true }), 'medium');
  assert.equal(decideTier({ badHit: true, aiHarmful: false }), 'low');
  assert.equal(decideTier({ badHit: false, aiHarmful: false, aiCleared: true }), 'low');
  assert.equal(decideTier({ badHit: false, aiHarmful: false, aiCleared: false }), null);
});

test('parseMentions extracts, normalizes and de-dupes', () => {
  assert.equal(parseMentions('ping <@111> and <@&222> and <@!333>'), '<@111> <@&222> <@333>');
  assert.equal(parseMentions('<@1> <@1> <@&2>'), '<@1> <@&2>');
  assert.equal(parseMentions('just text'), null);
  assert.equal(parseMentions(''), null);
  assert.equal(parseMentions(null), null);
});

test('truncate handles empty and overflow', () => {
  assert.equal(truncate(''), '*(no text content)*');
  assert.equal(truncate('abc', 10), 'abc');
  assert.ok(truncate('x'.repeat(50), 10).endsWith('…'));
});

test('TIERS has the expected colours/labels', () => {
  for (const tier of ['high', 'medium', 'low', 'good']) {
    assert.equal(typeof TIERS[tier].color, 'number');
    assert.equal(typeof TIERS[tier].label, 'string');
  }
});
