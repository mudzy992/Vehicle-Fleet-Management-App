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

  if (status === 'authenticated') {
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
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4 py-10 text-[var(--fg)]">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--primary)] text-sm font-bold text-white"
          >
            VP
          </span>
          <div>
            <h1 className="text-base font-semibold leading-tight">{APP_NAME}</h1>
            <p className="text-xs text-[var(--fg-muted)]">Prijava u web aplikaciju</p>
          </div>
        </div>

        <Card>
          <form className="space-y-4" onSubmit={(event) => void onSubmit(event)} noValidate>
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-xs font-medium text-[var(--fg-muted)]">
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
                className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm outline-none focus:border-[var(--primary)]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-xs font-medium text-[var(--fg-muted)]">
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
                className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm outline-none focus:border-[var(--primary)]"
              />
            </div>

            {error ? (
              <p role="alert" className="rounded-md border border-[var(--danger)] px-2.5 py-2 text-xs text-[var(--danger)]">
                {error}
              </p>
            ) : null}

            <Button type="submit" variant="primary" loading={pending} disabled={pending} className="w-full">
              Prijavi se
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-center text-[11px] text-[var(--fg-muted)]">
          Zaboravljena lozinka? Administrator vam izdaje jednokratni token za reset.
        </p>
      </div>
    </main>
  );
}
