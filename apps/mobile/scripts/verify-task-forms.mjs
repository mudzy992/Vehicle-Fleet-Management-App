/**
 * Provjera preduvjeta mobilnog wizarda: svaka aktivna vrsta zadatka mora imati
 * objavljenu i mobilno kompatibilnu ORDER i REALIZATION formu.
 *
 * Bez toga `CreateTaskScreen` ostane na koraku 2 (`task-create-active-form` se
 * nikad ne renderuje), pa Maestro tok pada tek u emulatoru — ovdje padne za
 * nekoliko sekundi i to s tačnim kodom vrste zadatka.
 */
const rawBaseUrl = process.env.P4_E2E_API_URL;
const email = process.env.TEST_ADMIN_EMAIL;
const password = process.env.TEST_ADMIN_PASSWORD;

if (!rawBaseUrl || !email || !password) {
  throw new Error('Nedostaju P4 E2E varijable za provjeru aktivnih formi.');
}

const apiBase = new URL(rawBaseUrl);
if (apiBase.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(apiBase.hostname)) {
  throw new Error('Provjera formi je dozvoljena samo prema lokalnom izolovanom CI API-ju.');
}

const apiRoot = `${apiBase.origin}${apiBase.pathname.replace(/\/$/u, '')}`;
const jsonHeaders = { 'content-type': 'application/json', 'x-client-type': 'MOBILE_ANDROID' };

async function readJson(response, label) {
  const text = await response.text();
  let payload = null;
  try {
    payload = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = payload?.error ?? {};
    const suffix = error.code ? ` ${error.code}: ${error.message ?? ''}` : ` ${text.slice(0, 300)}`;
    throw new Error(`${label} nije uspio (HTTP ${response.status})${suffix}`.trim());
  }
  return payload?.data ?? payload;
}

const login = await readJson(await fetch(`${apiRoot}/auth/login`, {
  method: 'POST',
  headers: jsonHeaders,
  body: JSON.stringify({
    email,
    password,
    clientType: 'MOBILE_ANDROID',
    deviceInfo: { model: 'CI Android emulator', appVersion: '1.0.0' },
  }),
}), 'Prijava admina');
const auth = { ...jsonHeaders, authorization: `Bearer ${login.accessToken}` };

const types = await readJson(
  await fetch(`${apiRoot}/task-types?activeOnly=true&page=1&pageSize=100`, { headers: auth }),
  'Vrste zadataka',
);

const problems = [];
for (const type of types.items) {
  for (const role of ['ORDER', 'REALIZATION']) {
    const url = `${apiRoot}/form-schemas/active?subject=TASK&taskTypeId=${encodeURIComponent(type.id)}&role=${role}`;
    try {
      const form = await readJson(await fetch(url, { headers: auth }), `${type.code} ${role}`);
      if (!form?.formSchemaId || typeof form.version !== 'number') {
        problems.push(`${type.code} ${role}: odgovor nema formSchemaId/version`);
        continue;
      }
      if (form.mobileCompatible !== true) {
        problems.push(`${type.code} ${role}: forma nije mobilno kompatibilna (${form.name ?? form.formSchemaId})`);
        continue;
      }
      console.log(`::notice title=Aktivna forma::${type.code} ${role} → ${form.name ?? ''} v${form.version}`);
    } catch (cause) {
      problems.push(`${type.code} ${role}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.log(`::error title=Aktivna forma::${problem}`);
  throw new Error(`Nedostaje ${problems.length} aktivnih formi za mobilni wizard.`);
}

console.log(`Aktivne forme: ${types.items.length} vrsta zadataka ima ORDER i REALIZATION formu.`);
