import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate persistence + seed a legacy settings file to exercise migration.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'tt-cfg-'));
writeFileSync(
  join(process.env.DATA_DIR, 'settings.json'),
  JSON.stringify({ g1: { flaggedWords: ['poop'], logFlagged: false } }),
);
const cfg = await import('../src/config.js');

test('legacy flaggedWords/logFlagged migrate to badWords/logBadWords', () => {
  const bad = cfg.listBadWords('g1');
  assert.equal(bad.length, 1);
  assert.equal(bad[0].word, 'poop');
  assert.equal(cfg.getServer('g1').logBadWords, false);
  assert.equal(cfg.getServer('g1').flaggedWords, undefined);
});

test('adding a word is an upsert that keeps omitted fields', () => {
  cfg.addBadWord('g2', 'slur', 'CH', '<@1>', true);
  const r = cfg.addBadWord('g2', 'slur', null, '<@2>'); // change notify only
  assert.equal(r.updated, true);
  assert.equal(r.entry.channelId, 'CH'); // kept
  assert.equal(r.entry.notify, '<@2>'); // changed
  assert.equal(r.entry.wholeword, true); // kept
  assert.equal(cfg.listBadWords('g2').length, 1); // no duplicate
});

test('duplicate-add does not create a second entry; remove works', () => {
  cfg.addGoodWord('g2b', 'welcome');
  cfg.addGoodWord('g2b', 'welcome');
  assert.equal(cfg.listGoodWords('g2b').length, 1);
  assert.equal(cfg.removeGoodWord('g2b', 'welcome').ok, true);
  assert.equal(cfg.removeGoodWord('g2b', 'welcome').ok, false);
});

test('export → import round-trips settings to a new server', () => {
  cfg.addGoodWord('g3', 'welcome', 'GC', null, false);
  cfg.setToggle('g3', 'antiSplit', true);
  cfg.setTierChannel('g3', 'high', 'HIGHCH');
  const data = cfg.exportServer('g3');
  const r = cfg.importServer('g4', data);
  assert.equal(r.ok, true);
  assert.ok(r.applied > 0);
  assert.equal(cfg.getServer('g4').antiSplit, true);
  assert.equal(cfg.getServer('g4').alertChannelHigh, 'HIGHCH');
  assert.equal(cfg.listGoodWords('g4').length, 1);
});

test('importServer rejects non-objects and clamps threshold', () => {
  assert.equal(cfg.importServer('g5', 'nope').ok, false);
  assert.equal(cfg.importServer('g5', null).ok, false);
  cfg.importServer('g5', { aiThreshold: 5 });
  assert.equal(cfg.getServer('g5').aiThreshold, 1); // clamped to [0,1]
});

test('watch channel list add/clear', () => {
  cfg.addWatchChannel('g6', 'c1');
  assert.deepEqual(cfg.listWatchChannels('g6'), ['c1']);
  assert.equal(cfg.addWatchChannel('g6', 'c1').ok, false); // dup
  cfg.clearWatchChannels('g6');
  assert.deepEqual(cfg.listWatchChannels('g6'), []);
});

test('anyDebugEnabled reflects the debug toggle', () => {
  assert.equal(cfg.anyDebugEnabled(), false);
  cfg.setToggle('g7', 'debugLogging', true);
  assert.equal(cfg.anyDebugEnabled(), true);
});

test('aiThreshold is clamped to [0,1]', () => {
  assert.equal(cfg.setAiThreshold('g8', 2), 1);
  assert.equal(cfg.setAiThreshold('g8', -1), 0);
  assert.equal(cfg.setAiThreshold('g8', 0.55), 0.55);
});
