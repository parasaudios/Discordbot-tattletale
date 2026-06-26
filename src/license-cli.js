// Owner key-management CLI. Run where licenses.json lives (set DATA_DIR to the
// same volume the bot uses). On a single hosted instance you'll usually mint via
// the owner Discord command instead; this is for local/self-host management.
//
//   node src/license-cli.js gen --days 30 --count 5 [--plan pro]
//   node src/license-cli.js gen --lifetime --count 1
//   node src/license-cli.js revoke --key TT-XXXX-XXXX-XXXX-XXXX
//   node src/license-cli.js list
import 'dotenv/config';
import { generateKeys, revokeKey, listKeys } from './licenses.js';

const [cmd, ...rest] = process.argv.slice(2);
const arg = (name, def) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : def; };
const has = (name) => rest.includes(`--${name}`);

switch (cmd) {
  case 'gen': {
    const durationDays = has('lifetime') ? null : Number(arg('days', 30));
    const count = Number(arg('count', 1));
    const plan = arg('plan', '');
    const keys = generateKeys({ durationDays, plan, count });
    console.log(`Generated ${keys.length} key(s) — ${durationDays === null ? 'lifetime' : `${durationDays} days`}${plan ? ` [${plan}]` : ''}:`);
    keys.forEach((k) => console.log(`  ${k}`));
    break;
  }
  case 'revoke': {
    const key = arg('key');
    if (!key) { console.error('Usage: revoke --key TT-...'); process.exit(1); }
    const r = revokeKey(key);
    console.log(r.ok ? `Revoked ${key.toUpperCase()}${r.serverId ? ` (was on server ${r.serverId})` : ''}.` : `Key not found: ${key}`);
    break;
  }
  case 'list': {
    const keys = listKeys();
    if (!keys.length) { console.log('No keys.'); break; }
    keys.forEach((k) => {
      const exp = k.expiresAt ? new Date(k.expiresAt).toISOString() : (k.durationDays === null ? 'lifetime' : 'not activated');
      console.log(`${k.key}  ${k.revoked ? 'REVOKED ' : ''}server=${k.serverId || '-'}  plan=${k.plan || '-'}  expires=${exp}`);
    });
    break;
  }
  default:
    console.log([
      'Usage:',
      '  node src/license-cli.js gen --days 30 --count 5 [--plan pro]',
      '  node src/license-cli.js gen --lifetime',
      '  node src/license-cli.js revoke --key TT-XXXX-XXXX-XXXX-XXXX',
      '  node src/license-cli.js list',
    ].join('\n'));
}
