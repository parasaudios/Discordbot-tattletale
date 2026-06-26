import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'tt-lic-'));
const lic = await import('../src/licenses.js');

test('generate → activate → status for a timed key', () => {
  const [key] = lic.generateKeys({ durationDays: 30, plan: 'pro' });
  assert.match(key, /^TT-[A-Z0-9-]+$/);
  assert.equal(lic.isLicensed('serverA'), false);
  const r = lic.activate('serverA', key);
  assert.equal(r.ok, true);
  assert.ok(r.expiresAt > Date.now());
  assert.equal(lic.isLicensed('serverA'), true);
  assert.equal(lic.licenseStatus('serverA').plan, 'pro');
});

test('activation is case-insensitive and trims', () => {
  const [key] = lic.generateKeys({ durationDays: 7 });
  assert.equal(lic.activate('serverCase', `  ${key.toLowerCase()}  `).ok, true);
});

test('lifetime key never expires', () => {
  const [key] = lic.generateKeys({ durationDays: null });
  lic.activate('serverLife', key);
  const st = lic.licenseStatus('serverLife');
  assert.equal(st.licensed, true);
  assert.equal(st.expiresAt, null);
});

test('a key is bound to exactly one server', () => {
  const [key] = lic.generateKeys({ durationDays: 7 });
  assert.equal(lic.activate('serverX', key).ok, true);
  const r = lic.activate('serverY', key);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bound_elsewhere');
  assert.equal(lic.activate('serverX', key).ok, true); // same server is idempotent
});

test('revoke immediately disables the license', () => {
  const [key] = lic.generateKeys({ durationDays: 30 });
  lic.activate('serverR', key);
  assert.equal(lic.isLicensed('serverR'), true);
  assert.equal(lic.revokeKey(key).ok, true);
  assert.equal(lic.isLicensed('serverR'), false);
  assert.equal(lic.activate('serverR2', key).reason, 'revoked');
});

test('an unknown key is rejected', () => {
  assert.equal(lic.activate('s', 'TT-DOES-NOT-EXIST').reason, 'invalid');
});

test('a key past its expiry is not licensed', () => {
  const [key] = lic.generateKeys({ durationDays: 0 }); // expires at activation time
  lic.activate('serverExp', key);
  assert.equal(lic.isLicensed('serverExp'), false);
});

test('LICENSE_EXEMPT_SERVERS bypasses the gate', () => {
  process.env.LICENSE_EXEMPT_SERVERS = 'exemptServer';
  assert.equal(lic.isLicensed('exemptServer'), true);
  assert.equal(lic.licenseStatus('exemptServer').exempt, true);
  delete process.env.LICENSE_EXEMPT_SERVERS;
});
