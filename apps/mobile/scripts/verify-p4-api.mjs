const rawBaseUrl = process.env.P4_E2E_API_URL;
const adminEmail = process.env.TEST_ADMIN_EMAIL;
const adminPassword = process.env.TEST_ADMIN_PASSWORD;
const regularEmail = process.env.TEST_USER_EMAIL;
const regularPassword = process.env.TEST_USER_PASSWORD;
const taskTitle = `P4-E2E-${process.env.TEST_RUN_ID ?? ''}`;

if (
  !rawBaseUrl ||
  !adminEmail ||
  !adminPassword ||
  !regularEmail ||
  !regularPassword ||
  !process.env.TEST_RUN_ID
) {
  throw new Error('Nedostaju P4 E2E varijable okruženja.');
}

const apiBase = new URL(rawBaseUrl);
if (apiBase.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(apiBase.hostname)) {
  throw new Error('P4 API provjera je dozvoljena samo prema lokalnom izolovanom CI API-ju.');
}

async function login(email, password) {
  const response = await fetch(`${apiBase.origin}${apiBase.pathname.replace(/\/$/u, '')}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-type': 'MOBILE_ANDROID' },
    body: JSON.stringify({
      email,
      password,
      clientType: 'MOBILE_ANDROID',
      deviceInfo: { model: 'CI Android emulator', appVersion: '1.0.0' },
    }),
  });
  const payload = await response.json();
  if (!response.ok || typeof payload.data?.accessToken !== 'string') {
    throw new Error(`P4 test prijava nije uspjela (HTTP ${response.status}).`);
  }
  return payload.data.accessToken;
}

const adminToken = await login(adminEmail, adminPassword);
const tasksResponse = await fetch(
  `${apiBase.origin}${apiBase.pathname.replace(/\/$/u, '')}/tasks?mine=true&page=1&pageSize=50&sortBy=updatedAt&sortOrder=desc`,
  { headers: { authorization: `Bearer ${adminToken}`, 'x-client-type': 'MOBILE_ANDROID' } },
);
const taskPayload = await tasksResponse.json();
if (!tasksResponse.ok || !Array.isArray(taskPayload.data?.items)) {
  throw new Error(`P4 lista zadataka nije dostupna (HTTP ${tasksResponse.status}).`);
}
const matches = taskPayload.data.items.filter((item) => item.title === taskTitle);
if (matches.length !== 1) {
  throw new Error(`P4 zadatak nije tačno jednom vidljiv u API listi (broj=${matches.length}).`);
}

const regularToken = await login(regularEmail, regularPassword);
const deniedResponse = await fetch(`${apiBase.origin}${apiBase.pathname.replace(/\/$/u, '')}/tasks`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${regularToken}`,
    'content-type': 'application/json',
    'x-client-type': 'MOBILE_ANDROID',
  },
  body: '{}',
});
const deniedPayload = await deniedResponse.json();
if (deniedResponse.status !== 403 || deniedPayload.error?.code !== 'PERMISSION_DENIED') {
  throw new Error(`P4 POST bez task:create mora biti 403 (dobijeno HTTP ${deniedResponse.status}).`);
}

console.log('P4 API: kreirani zadatak je vidljiv u listi; korisnik bez task:create dobija 403.');
