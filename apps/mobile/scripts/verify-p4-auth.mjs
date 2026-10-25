const rawBaseUrl = process.env.P4_E2E_API_URL;
const credentials = [
  ['admin', process.env.TEST_ADMIN_EMAIL, process.env.TEST_ADMIN_PASSWORD],
  ['ordinary user', process.env.TEST_USER_EMAIL, process.env.TEST_USER_PASSWORD],
];

if (!rawBaseUrl || credentials.some(([, email, password]) => !email || !password)) {
  throw new Error('Nedostaju P4 E2E auth varijable okruženja.');
}

const apiBase = new URL(rawBaseUrl);
if (apiBase.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(apiBase.hostname)) {
  throw new Error('P4 auth provjera je dozvoljena samo prema lokalnom izolovanom CI API-ju.');
}

const apiRoot = `${apiBase.origin}${apiBase.pathname.replace(/\/$/u, '')}`;
for (const [label, email, password] of credentials) {
  const response = await fetch(`${apiRoot}/auth/login`, {
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
    throw new Error(`P4 prijava za ${label} nije uspjela (HTTP ${response.status}).`);
  }
}

console.log('P4 auth preflight: oba privremena naloga mogu se prijaviti kao MOBILE_ANDROID.');
