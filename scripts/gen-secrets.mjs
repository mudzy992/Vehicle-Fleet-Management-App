#!/usr/bin/env node
/**
 * ============================================================================
 *  VFM — gen-secrets
 * ============================================================================
 *  Generiše sve tajne potrebne za aplikaciju i ispisuje ih u formatu koji se
 *  može direktno zalijepiti u Coolify → Environment Variables ili u lokalni .env.
 *
 *  NIKAD ne commituj izlaz ove skripte. `.env` je u .gitignore.
 *
 *  Upotreba:
 *    node scripts/gen-secrets.mjs              # sve tajne (env format)
 *    node scripts/gen-secrets.mjs --redis      # + SHA-256 hash-ove za Redis ACL
 *    node scripts/gen-secrets.mjs --json       # JSON izlaz (za skripte)
 *    node scripts/gen-secrets.mjs --write .env # zapiši u fajl (0600)
 * ============================================================================
 */

import { randomBytes, createHash } from 'node:crypto';
import { writeFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const withRedis = args.includes('--redis');
const writeIdx = args.indexOf('--write');
const writePath = writeIdx >= 0 ? args[writeIdx + 1] : null;

/** Base64 tajna (URL-safe bez paddinga) */
const secret = (bytes = 48) => randomBytes(bytes).toString('base64url');
/** Alfanumerička lozinka (za DB/Redis gdje base64 smeta) */
const password = (len = 40) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const out = [];
  const buf = randomBytes(len * 2);
  for (let i = 0; out.length < len; i++) {
    const c = alphabet[buf[i] % alphabet.length];
    if (c) out.push(c);
  }
  return out.join('');
};
const sha256 = (v) => createHash('sha256').update(v).digest('hex');

const redisApi = password(48);
const redisWorker = password(48);
const redisReadonly = password(48);

const values = {
  JWT_ACCESS_SECRET: secret(64),
  JWT_REFRESH_SECRET: secret(64),
  FILE_SIGNING_SECRET: secret(32),
  DATABASE_PASSWORD: password(32),
  REDIS_PASSWORD_API: redisApi,
  REDIS_PASSWORD_WORKER: redisWorker,
  REDIS_PASSWORD_READONLY: redisReadonly,
};

if (withRedis) {
  values.__REDIS_ACL_SHA256 = {
    'vfm-api': sha256(redisApi),
    'vfm-worker': sha256(redisWorker),
    'vfm-readonly': sha256(redisReadonly),
  };
}

if (asJson) {
  process.stdout.write(JSON.stringify(values, null, 2) + '\n');
} else {
  const lines = [
    '# === VFM generisane tajne — zalijepiti u Coolify Environment Variables ===',
    '# Generisano: ' + new Date().toISOString(),
    '# Upozorenje: nakon upotrebe OBAVEZNO obrisati terminal historiju / clipboard.',
    '',
    ...Object.entries(values)
      .filter(([k]) => !k.startsWith('__'))
      .map(([k, v]) => `${k}=${v}`),
  ];

  if (withRedis) {
    const h = values.__REDIS_ACL_SHA256;
    lines.push(
      '',
      '# === Redis ACL (vidi REDIS_ACL.md §1) — hash-ovi idu u ACL fajl iza "#" ===',
      `# user vfm-api on #${h['vfm-api']} ~vfm:* &* +@all -flushdb -flushall -debug -shutdown -config -acl -keys -swapdb -reset -failover`,
      `# user vfm-worker on #${h['vfm-worker']} ~vfm:* &* +@all -flushdb -flushall -debug -shutdown -config -acl -keys -swapdb -reset -failover`,
      `# user vfm-readonly on #${h['vfm-readonly']} ~vfm:* &* +@read +ping +info +client|getname +client|setname +client|id +client|list +scan +type +ttl +pttl +exists +dbsize +memory|usage +memory|stats +slowlog|get +latency|latest -keys -debug -config -acl`,
      '',
      '# ⚠️ Nakon izmjene ACL fajla na serveru pokrenuti:  redis-cli --user <admin> ACL LOAD',
    );
  }

  const out = lines.join('\n') + '\n';

  if (writePath) {
    if (existsSync(writePath)) {
      const cur = readFileSync(writePath, 'utf8');
      writeFileSync(writePath + '.bak', cur);
      process.stderr.write(`ℹ️  Postojeći fajl sačuvan kao ${writePath}.bak\n`);
    }
    writeFileSync(writePath, out);
    chmodSync(writePath, 0o600);
    process.stderr.write(`✅ Tajne zapisane u ${writePath} (0600)\n`);
  } else {
    process.stdout.write(out);
  }
}
