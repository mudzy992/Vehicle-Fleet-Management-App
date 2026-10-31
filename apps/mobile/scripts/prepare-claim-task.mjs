/**
 * Priprema OPEN WASH zadatak za Maestro tok `task-claim-complete-lite`.
 *
 * Seedovana ORDER forma za WASH (`pranje_vozila_nalog`) traži `washType` i
 * obavezne `photosBefore` (`PHOTO`, `minFiles: 1`, `image/jpeg|image/png`), pa
 * skripta prvo uploaduje mali PNG preko `POST /attachments`, a zatim ga šalje
 * kao vrijednost polja `photosBefore`. Bez priloga API odbija kreiranje
 * (`FORM_VALIDATION_FAILED`) i claim korak u toku nema šta preuzeti.
 */
const rawBaseUrl = process.env.P4_E2E_API_URL;
const adminEmail = process.env.TEST_ADMIN_EMAIL;
const adminPassword = process.env.TEST_ADMIN_PASSWORD;
const title = process.env.CLAIM_TASK_TITLE;

if (!rawBaseUrl || !adminEmail || !adminPassword || !title) {
  throw new Error('Nedostaju P4 E2E varijable za pripremu claim zadatka.');
}

const apiBase = new URL(rawBaseUrl);
if (apiBase.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(apiBase.hostname)) {
  throw new Error('Priprema claim zadatka je dozvoljena samo prema lokalnom izolovanom CI API-ju.');
}

const apiRoot = `${apiBase.origin}${apiBase.pathname.replace(/\/$/u, '')}`;
const headers = { 'content-type': 'application/json', 'x-client-type': 'MOBILE_ANDROID' };

/**
 * Čita JSON envelope (`{ data }` ili goli objekat) i na grešci prijavljuje
 * `code`/`message`/`details` iz `{ error }` envelope-a, da CI log kaže *šta*
 * validacija traži umjesto samo „HTTP 422".
 */
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
    const details = Array.isArray(error.details)
      ? ` [${error.details.map((item) => `${(item.path ?? []).join('.')}: ${item.message}`).join('; ')}]`
      : '';
    const description = error.code ? ` ${error.code}: ${error.message ?? ''}${details}` : ` ${text.slice(0, 300)}`;
    throw new Error(`${label} nije uspio (HTTP ${response.status})${description}`.trim());
  }
  return payload?.data ?? payload;
}

const login = await readJson(await fetch(`${apiRoot}/auth/login`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    email: adminEmail,
    password: adminPassword,
    clientType: 'MOBILE_ANDROID',
    deviceInfo: { model: 'CI Android emulator', appVersion: '1.0.0' },
  }),
}), 'Prijava admina');
const auth = { ...headers, authorization: `Bearer ${login.accessToken}` };

/** 1×1 PNG — prolazi magic-byte provjeru i `mimeTypes` pravilo PHOTO polja. */
const PHOTO_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const uploadBody = new FormData();
uploadBody.append('file', new Blob([PHOTO_BYTES], { type: 'image/png' }), 'ci-foto-prije.png');
const uploaded = await readJson(await fetch(`${apiRoot}/attachments`, {
  method: 'POST',
  // Bez `content-type`: `fetch` sam postavlja multipart boundary.
  headers: { 'x-client-type': 'MOBILE_ANDROID', authorization: `Bearer ${login.accessToken}` },
  body: uploadBody,
}), 'Upload fotografije');
if (typeof uploaded?.id !== 'string' || uploaded.id.length === 0) {
  throw new Error('Upload fotografije nije vratio ID priloga.');
}

const types = await readJson(await fetch(`${apiRoot}/task-types?activeOnly=true&page=1&pageSize=100`, { headers: auth }), 'Vrste zadataka');
const wash = types.items.find((item) => item.code === 'WASH');
if (!wash) throw new Error('WASH vrsta zadatka nije seedovana.');

const vehicles = await readJson(await fetch(`${apiRoot}/vehicles?page=1&pageSize=100&status=ACTIVE`, { headers: auth }), 'Vozila');
const vehicle = vehicles.items.find((item) => item.internalNo === 'VFM-001') ?? vehicles.items[0];
if (!vehicle) throw new Error('Nema aktivnog vozila za claim seed.');

const created = await readJson(await fetch(`${apiRoot}/tasks`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({
    taskTypeId: wash.id,
    vehicleId: vehicle.id,
    title,
    assignMode: 'BROADCAST',
    orderFormData: { washType: 'INTERNAL', photosBefore: [uploaded.id] },
  }),
}), 'Kreiranje claim zadatka');

if (created.status !== 'OPEN') throw new Error(`Claim zadatak nije OPEN (status=${created.status}).`);
console.log(`Claim seed: ${created.id} ${title}`);
