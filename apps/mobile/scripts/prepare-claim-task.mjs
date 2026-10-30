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

async function readJson(response, label) {
  const payload = await response.json();
  if (!response.ok) throw new Error(`${label} nije uspio (HTTP ${response.status}).`);
  return payload.data ?? payload;
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
    formData: { washType: 'INTERNAL' },
  }),
}), 'Kreiranje claim zadatka');

if (created.status !== 'OPEN') throw new Error(`Claim zadatak nije OPEN (status=${created.status}).`);
console.log(`Claim seed: ${created.id} ${title}`);
