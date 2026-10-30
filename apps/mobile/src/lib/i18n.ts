export type Locale = 'bs' | 'en';

const bs = {
  mobileAccessForbidden: 'Prijava u mobilnu aplikaciju nije dostupna za Super Admin nalog. Koristite web portal.',
  sessionExpired: 'Sesija je istekla. Prijavite se ponovo da nastavite.',
  noNetwork: 'Nema mrežne veze. Provjerite internet i pokušajte ponovo.',
  generic403: 'Server nije dozvolio pristup ovom sadržaju. Osvježite prikaz ili kontaktirajte administratora.',
  generic404: 'Traženi zapis više nije dostupan.',
  generic409: 'Podaci su se promijenili. Osvježite prikaz i pokušajte ponovo.',
  generic429: 'Previše je zahtjeva u kratkom vremenu. Sačekajte i pokušajte ponovo.',
  generic5xx: 'Usluga trenutno nije dostupna. Pokušajte ponovo za nekoliko trenutaka.',
  retry: 'Pokušaj ponovo',
  noPermission: 'Nemate pravo za ovaj sadržaj.',
  showMore: 'Prikaži još',
  loadMoreHint: 'Prikazan je prvi skup rezultata. Osvježite listu ili suzite pretragu na webu za ostale zapise.',
  recordTypeUnsupported: 'Ovaj tip zapisa nije dostupan u mobilnoj formi.',
  tireSetsNeedVehicle: 'Nema kompleta guma za vozilo. Podesite params.vehicleId i dozvolu tire:view.',
  fcmOwnerNote: 'Push dostava zavisi od Firebase/FCM konfiguracije vlasnika sistema.',
  emailInactive: 'E-mail kanal trenutno nije aktivan; postavka je samo informativna.',
  notificationPrefs: 'Postavke obavijesti',
  noDeadline: 'Nema podataka',
  expired: 'Isteklo',
  offlineBanner: 'Nema internet veze. Pisanje je onemogućeno dok se veza ne vrati.',
} as const;

const en: Record<keyof typeof bs, string> = {
  mobileAccessForbidden: 'Mobile sign-in is not available for a Super Admin account. Use the web portal.',
  sessionExpired: 'The session expired. Sign in again to continue.',
  noNetwork: 'No network connection. Check the internet and try again.',
  generic403: 'The server did not allow access to this content. Refresh or contact an administrator.',
  generic404: 'The requested record is no longer available.',
  generic409: 'The data changed. Refresh and try again.',
  generic429: 'Too many requests in a short time. Wait and try again.',
  generic5xx: 'The service is temporarily unavailable. Try again in a few moments.',
  retry: 'Try again',
  noPermission: 'You do not have permission for this content.',
  showMore: 'Show more',
  loadMoreHint: 'The first result set is shown. Refresh or narrow the search on web for the rest.',
  recordTypeUnsupported: 'This record type is not available in the mobile form.',
  tireSetsNeedVehicle: 'No tire sets for the vehicle. Set params.vehicleId and tire:view.',
  fcmOwnerNote: 'Push delivery depends on the owner Firebase/FCM configuration.',
  emailInactive: 'The email channel is currently inactive; this setting is informational only.',
  notificationPrefs: 'Notification settings',
  noDeadline: 'No data',
  expired: 'Expired',
  offlineBanner: 'No internet connection. Writing is disabled until the connection returns.',
};

let locale: Locale = 'bs';

export function setLocale(next: Locale): void {
  locale = next;
}

export function t(key: keyof typeof bs): string {
  return locale === 'en' ? en[key] : bs[key];
}
