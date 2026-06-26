import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'tt-scr-'));
process.env.FLOOD_COOLDOWN_MS = '60000'; // long, so within-test repeats are suppressed
// Screening is license-gated; exempt the test servers so we test screening, not licensing.
process.env.LICENSE_EXEMPT_SERVERS = 'sGood,sBad,sClean,sEdit,sFlood,sSplit,sDel';
const cfg = await import('../src/config.js');
const scr = await import('../src/screening.js');

// Build a fake guild/message with a send-capturing channel layer.
function env(serverId) {
  const sent = [];
  const channelFor = (id) => ({
    id,
    isTextBased: () => true,
    send: (p) => { sent.push({ channel: id, color: p.embeds?.[0]?.data?.color, title: p.embeds?.[0]?.data?.title, content: p.content }); return Promise.resolve(); },
    toString: () => `#${id}`,
  });
  const guild = {
    id: serverId,
    channels: { cache: { get: channelFor }, fetch: (id) => Promise.resolve(channelFor(id)) },
    members: { me: { permissions: { has: () => false } } }, // no View Audit Log → whoDeleted returns null
  };
  const msg = (content, { user = 'u1', channel = 'chan' } = {}) => ({
    author: { bot: false, id: user, tag: `${user}#1`, toString: () => `<@${user}>` },
    guild,
    channel: { id: channel, parentId: null, toString: () => `#${channel}` },
    content,
    url: 'http://m',
    createdAt: new Date(),
    editedTimestamp: Date.now(),
    partial: false,
  });
  return { sent, msg, guild };
}

const GREEN = 0x57F287;
const LOW = 0xF1C40F;

test('good word → green notice to the good channel', async () => {
  const s = 'sGood';
  cfg.getServer(s).alertChannelId = 'DEF';
  cfg.setTierChannel(s, 'good', 'GOODCH');
  cfg.addGoodWord(s, 'welcome');
  const { sent, msg } = env(s);
  await scr.screenMessage(msg('hey welcome friend'));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, 'GOODCH');
  assert.equal(sent[0].color, GREEN);
});

test('bad word with judging off → low tier to the low channel', async () => {
  const s = 'sBad';
  cfg.getServer(s).alertChannelId = 'DEF';
  cfg.setTierChannel(s, 'low', 'LOWCH');
  cfg.addBadWord(s, 'slur');
  const { sent, msg } = env(s);
  await scr.screenMessage(msg('you slur', { user: 'uBad' }));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, 'LOWCH');
  assert.equal(sent[0].color, LOW);
});

test('clean message → no alert', async () => {
  const s = 'sClean';
  cfg.getServer(s).alertChannelId = 'DEF';
  cfg.addBadWord(s, 'slur');
  const { sent, msg } = env(s);
  await scr.screenMessage(msg('totally fine text', { user: 'uClean' }));
  assert.equal(sent.length, 0);
});

test('edit channel overrides severity routing for edit-caused alerts', async () => {
  const s = 'sEdit';
  cfg.getServer(s).alertChannelId = 'DEF';
  cfg.setTierChannel(s, 'low', 'LOWCH');
  cfg.setTierChannel(s, 'edits', 'EDITCH');
  cfg.addBadWord(s, 'slur');
  const { sent, msg } = env(s);
  await scr.screenMessage(msg('a slur', { user: 'uEdit' }), 'edited');
  assert.equal(sent[0].channel, 'EDITCH');
});

test('flood control suppresses repeated identical alerts', async () => {
  const s = 'sFlood';
  cfg.getServer(s).alertChannelId = 'DEF';
  cfg.addBadWord(s, 'slur');
  const { sent, msg } = env(s);
  await scr.screenMessage(msg('slur', { user: 'uFlood' }));
  await scr.screenMessage(msg('slur', { user: 'uFlood' }));
  await scr.screenMessage(msg('slur', { user: 'uFlood' }));
  assert.equal(sent.length, 1); // only the first within the cooldown
});

test('anti-evasion catches a bad word split across messages', async () => {
  const s = 'sSplit';
  cfg.getServer(s).alertChannelId = 'DEF';
  cfg.setTierChannel(s, 'high', 'HIGHCH');
  cfg.addBadWord(s, 'cunt');
  cfg.setToggle(s, 'antiSplit', true);
  const { sent, msg } = env(s);
  for (const part of ['c', 'u', 'n', 't']) await scr.screenSplitEvasion(msg(part, { user: 'uSplit' }));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, 'HIGHCH');
});

test('handleDelete only logs flagged messages by default (onlyflagged on)', async () => {
  const s = 'sDel';
  cfg.getServer(s).alertChannelId = 'DEF';
  cfg.addBadWord(s, 'slur');
  assert.equal(cfg.getServer(s).logFlaggedOnly, true); // default
  const { sent, msg } = env(s);
  await scr.handleDelete(msg('just chatting', { user: 'uDel' }));
  assert.equal(sent.length, 0); // benign delete not logged
  await scr.handleDelete(msg('a slur', { user: 'uDel' }));
  assert.equal(sent.length, 1); // flagged delete logged
});

test('sweepBuffers runs without throwing', () => {
  assert.doesNotThrow(() => scr.sweepBuffers());
});
