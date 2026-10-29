/**
 * Prijava (W01, docs/06 §5.5) — jedini javni ekran.
 *
 * Sigurnosne odluke koje se vide u UI-u:
 * - poruka o grešci je **uvijek ista** za pogrešan e-mail i pogrešnu lozinku
 *   (server ne otkriva postoji li nalog — docs/05 §7),
 * - `ACCOUNT_LOCKED` i `RATE_LIMITED` daju jasnu poruku „pokušajte kasnije",
 * - poslije prijave s `mustChangePassword=true` korisnik ide na `/profil`
 *   (bootstrap/reset lozinke) umjesto na traženu stranicu,
 * - Super Admin na mobilnom je odbijen na serveru (`MOBILE_ACCESS_FORBIDDEN`);
 *   web klijent taj kod ne može dobiti, ali se poruka ipak mapira.
 */
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { APP_NAME } from '@vfm/shared';
import { Button, Card } from '../../components/ui/index.js';
import { ApiError } from '../../lib/api.js';
import { useSession } from './session.js';

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  INVALID_CREDENTIALS: 'Pogrešan e-mail ili lozinka.',
  ACCOUNT_LOCKED: 'Nalog je privremeno zaključan zbog neuspješnih prijava. Pokušajte kasnije.',
  ACCOUNT_INACTIVE: 'Nalog nije aktivan. Obratite se administratoru.',
  RATE_LIMITED: 'Previše pokušaja prijave. Sačekajte pa pokušajte ponovo.',
  MOBILE_ACCESS_FORBIDDEN: 'Super Administrator se prijavljuje isključivo s web aplikacije.',
  MOBILE_SCOPE_NOT_ALLOWED: 'Vaša rola ne dozvoljava pristup s ovog tipa uređaja.',
  VALIDATION_ERROR: 'Provjerite unos (e-mail mora biti ispravan, lozinka ne smije biti prazna).',
};

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    return ERROR_MESSAGES[error.code] ?? `Prijava nije uspjela (${error.code}).`;
  }
  return 'Prijava nije uspjela — provjerite vezu s API-jem.';
}

/** Gdje korisnik ide poslije prijave (`?next=` smije biti samo interna putanja). */
function nextPath(search: string): string {
  const next = new URLSearchParams(search).get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/nadzorna-tabla';
  return next;
}

export function LoginPage() {
  const { status, login } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // login() publishes the authenticated state before its promise resolves. Keep
  // the form mounted until its submit handler can honor mustChangePassword.
  if (status === 'authenticated' && !pending) {
    return <Navigate to={nextPath(location.search)} replace />;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const user = await login({ email: email.trim(), password });
      navigate(user.mustChangePassword ? '/profil?promjena=1' : nextPath(location.search), { replace: true });
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="vfm-login-shell">
      <section className="vfm-login-story" aria-label="Informacije o sistemu">
        <div className="vfm-login-brand">
          <span className="vfm-brand-mark" aria-hidden="true">
            V
          </span>
          <span>{APP_NAME}</span>
        </div>
        <div className="vfm-login-story-copy">
          <p className="vfm-eyebrow">FLEET OPERATIONS PLATFORM</p>
          <h2>
            Vaš vozni park.
            <br />
            <span>Pod potpunom kontrolom.</span>
          </h2>
          <p>Jedno mjesto za vozila, timove, zadatke i rokove — uz jasnu sliku svakodnevnog poslovanja.</p>
        </div>
        <div className="vfm-login-visual" aria-hidden="true">
          <div className="vfm-orbit vfm-orbit-one" />
          <div className="vfm-orbit vfm-orbit-two" />
          <div className="vfm-visual-core">
            <span>VP</span>
            <i />
          </div>
          <div className="vfm-visual-line" />
        </div>
        <p className="vfm-login-footnote">Siguran pristup za ovlaštene korisnike · bs-BA</p>
      </section>
      <section className="vfm-login-panel" aria-labelledby="login-title">
        <div className="vfm-login-form-wrap">
          <div className="vfm-login-mobile-brand">
            <span className="vfm-brand-mark" aria-hidden="true">
              V
            </span>
            <span>{APP_NAME}</span>
          </div>
          <p className="vfm-login-context">Prijava u web aplikaciju</p>
          <p className="vfm-eyebrow">DOBRO DOŠLI NAZAD</p>
          <h1 id="login-title" className="vfm-login-title">
            Prijavite se
          </h1>
          <p className="vfm-login-subtitle">Unesite svoje podatke za pristup radnom prostoru.</p>
          <Card className="vfm-login-card">
            <form className="space-y-5" onSubmit={(event) => void onSubmit(event)} noValidate>
              <div className="space-y-2">
                <label htmlFor="email" className="block text-sm font-medium text-[var(--fg)]">
                  E-mail
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="ime@organizacija.ba"
                  className="h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="password" className="block text-sm font-medium text-[var(--fg)]">
                  Lozinka
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Unesite lozinku"
                  className="h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--primary)]"
                />
              </div>
              {error ? (
                <p
                  role="alert"
                  className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2.5 text-sm text-[var(--danger)]"
                >
                  {error}
                </p>
              ) : null}
              <Button
                type="submit"
                variant="primary"
                loading={pending}
                disabled={pending}
                className="vfm-login-submit w-full"
              >
                Prijavi se <span aria-hidden="true">→</span>
              </Button>
            </form>
          </Card>
          <p className="vfm-login-help">
            Zaboravljena lozinka? Obratite se administratoru za jednokratni token za reset.
          </p>
          <p className="vfm-login-security">
            <span aria-hidden="true">●</span> Zaštićena sesija · Podaci se prenose sigurno
          </p>
        </div>
      </section>
    </main>
  );
}
