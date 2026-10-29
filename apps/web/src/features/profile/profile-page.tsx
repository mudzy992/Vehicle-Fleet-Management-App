/**
 * Profil (W28, docs/06 §5.5) — moj nalog, aktivne sesije, promjena lozinke.
 *
 * - `GET /auth/me` daje profil i efektivna prava; `GET /auth/sessions` listu
 *   uređaja (samo vlastite sesije — tuđe se vide kroz Korisnici).
 * - Promjena lozinke traži staru lozinku i **revokuje sve sesije** (server), pa
 *   se korisnik poslije uspjeha vraća na prijavu — to je namjerno, ne bug.
 * - „Odjavi sve uređaje“ = `POST /auth/logout-all` (`auth:manage_sessions`).
 * - Ako je korisnik došao s `mustChangePassword=true`, forma za promjenu je
 *   otvorena i istaknuta (bootstrap/reset lozinke).
 */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  inputClassName,
} from '../../components/ui/index.js';
import { ApiError, api } from '../../lib/api.js';
import { useSession } from '../auth/session.js';

interface ActiveSession {
  readonly id: string;
  readonly clientType: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly lastUsedAt: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly deviceInfo: Record<string, string> | null;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('bs-BA', { timeZone: 'Europe/Sarajevo' });
}

export function ProfilePage() {
  const { user, hasPermission, logout } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const forced = params.get('promjena') === '1' || user?.mustChangePassword === true;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const sessions = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: () => api.get<readonly ActiveSession[]>('/auth/sessions'),
    enabled: hasPermission('auth:manage_sessions'),
  });

  const changePassword = useMutation({
    mutationFn: () => api.post<void>('/auth/change-password', { currentPassword, newPassword }),
    onSuccess: () => {
      setFeedback('Lozinka je promijenjena. Sve sesije su odjavljene — prijavite se ponovo.');
      // Server je revokovao sesije; lokalno stanje mora pasti.
      void logout({ serverAlreadyRevoked: true }).finally(() => navigate('/prijava', { replace: true }));
    },
  });

  const revokeAll = useMutation({
    mutationFn: () => api.post<{ revokedSessions: number }>('/auth/logout-all'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
      void logout({ serverAlreadyRevoked: true }).finally(() => navigate('/prijava', { replace: true }));
    },
  });

  const revokeOne = useMutation({
    mutationFn: (id: string) => api.delete<{ currentSessionRevoked: boolean }>(`/auth/sessions/${id}`),
    onSuccess: (result) => {
      if (result.currentSessionRevoked) {
        // Cookie je serverom obrisan; završimo lokalnu sesiju bez slanja
        // refresh zahtjeva za sesiju koju smo upravo opozvali.
        void logout({ serverAlreadyRevoked: true }).finally(() => navigate('/prijava', { replace: true }));
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
  });

  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;
  const submitError = changePassword.error instanceof ApiError ? changePassword.error : null;
  const sessionActionError = revokeAll.error ?? revokeOne.error;
  const sessionQueryError = sessions.error;

  return (
    <div className="vfm-module-page">
      <header>
        <h1 className="vfm-module-title">Profil</h1>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">
          Upravljajte podacima naloga, lozinkom i aktivnim sesijama.
        </p>
      </header>

      {forced ? (
        <Card>
          <p className="text-sm font-medium text-[var(--warning,var(--fg))]">Potrebna je promjena lozinke</p>
          <p className="mt-1 text-[11px] text-[var(--fg-muted)]">
            Nalog je kreiran s privremenom lozinkom (bootstrap ili reset). Postavite novu lozinku da
            nastavite.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-sm font-medium">Moj nalog</h2>
          {user ? (
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--fg-muted)]">Ime</dt>
                <dd>
                  {user.firstName} {user.lastName}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--fg-muted)]">E-mail</dt>
                <dd className="truncate">{user.email}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--fg-muted)]">Role</dt>
                <dd className="flex flex-wrap justify-end gap-1">
                  {user.roles.map((role) => (
                    <Badge key={role.id}>{role.code}</Badge>
                  ))}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--fg-muted)]">Prava</dt>
                <dd>{user.isSuperAdmin ? 'sva (Super Admin)' : `${user.permissions.length} permisija`}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--fg-muted)]">Zadnja prijava</dt>
                <dd className="text-xs">{formatDateTime(user.lastLoginAt)}</dd>
              </div>
            </dl>
          ) : (
            <EmptyState title="Nema podataka" />
          )}
        </Card>

        <Card>
          <h2 className="text-sm font-medium">Promjena lozinke</h2>
          <form
            className="mt-2 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              setFeedback(null);
              changePassword.mutate();
            }}
          >
            <Field label="Trenutna lozinka" htmlFor="current-password">
              <input
                id="current-password"
                type="password"
                autoComplete="current-password"
                required
                className={inputClassName}
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </Field>
            <Field
              label="Nova lozinka"
              htmlFor="new-password"
              hint="Najmanje 12 znakova, 3 od 4 klase (mala/velika slova, cifre, simboli)."
            >
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                className={inputClassName}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </Field>
            <Field
              label="Potvrda nove lozinke"
              htmlFor="confirm-password"
              error={mismatch ? 'Lozinke se ne poklapaju.' : null}
            >
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                className={inputClassName}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </Field>

            {submitError ? (
              <div role="alert" className="space-y-1 text-[11px] text-[var(--danger)]">
                <p>
                  {submitError.message} ({submitError.code})
                </p>
                {submitError.details?.slice(0, 4).map((detail) => (
                  <p key={`${detail.path.join('.')}-${detail.message}`}>• {detail.message}</p>
                ))}
              </div>
            ) : null}
            {feedback ? <p className="text-[11px] text-[var(--success,var(--fg))]">{feedback}</p> : null}

            <Button
              type="submit"
              variant="primary"
              loading={changePassword.isPending}
              disabled={changePassword.isPending || mismatch || newPassword.length < 12}
            >
              Promijeni lozinku
            </Button>
          </form>
        </Card>
      </div>

      <Card flush>
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <h2 className="text-sm font-medium">Aktivne sesije</h2>
            <p className="text-[11px] text-[var(--fg-muted)]">
              „Odjavi sve“ revokuje sve uređaje i diže <code>tokenVersion</code> — stari tokeni padaju odmah.
            </p>
          </div>
          {hasPermission('auth:manage_sessions') ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              loading={revokeAll.isPending}
              onClick={() => revokeAll.mutate()}
            >
              Odjavi sve uređaje
            </Button>
          ) : null}
        </div>

        {sessionActionError ? (
          <p className="px-4 pb-3 text-sm text-[var(--danger)]" role="alert">
            {sessionActionError instanceof ApiError
              ? sessionActionError.message
              : 'Greška pri opozivu sesije.'}
          </p>
        ) : null}

        {!hasPermission('auth:manage_sessions') ? (
          <div className="px-4 pb-4">
            <EmptyState
              title="Pregled sesija nije dozvoljen"
              description="Traži pravo auth:manage_sessions."
            />
          </div>
        ) : sessions.isLoading ? (
          <p className="px-4 pb-4 text-xs text-[var(--fg-muted)]" role="status">
            Učitavanje…
          </p>
        ) : sessionQueryError ? (
          <p className="px-4 pb-4 text-sm text-[var(--danger)]" role="alert">
            {sessionQueryError instanceof ApiError
              ? sessionQueryError.message
              : 'Greška pri učitavanju sesija.'}
          </p>
        ) : !sessions.data || sessions.data.length === 0 ? (
          <div className="px-4 pb-4">
            <EmptyState title="Nema aktivnih sesija" />
          </div>
        ) : (
          <Table scrollLabel="Aktivne sesije — pomjerite tabelu horizontalno za pregled svih kolona">
            <THead>
              <TR>
                <TH>Klijent</TH>
                <TH>Uređaj</TH>
                <TH>IP</TH>
                <TH>Prijava</TH>
                <TH>Istječe</TH>
                <TH align="right"> </TH>
              </TR>
            </THead>
            <TBody>
              {sessions.data.map((session) => (
                <TR key={session.id}>
                  <TD>{session.clientType}</TD>
                  <TD className="text-xs text-[var(--fg-muted)]">
                    {session.deviceInfo
                      ? [
                          session.deviceInfo.model,
                          session.deviceInfo.osVersion,
                          session.deviceInfo.appVersion,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : (session.userAgent ?? '—')}
                  </TD>
                  <TD className="font-mono text-xs">{session.ipAddress ?? '—'}</TD>
                  <TD className="text-xs">{formatDateTime(session.createdAt)}</TD>
                  <TD className="text-xs">{formatDateTime(session.expiresAt)}</TD>
                  <TD align="right">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      loading={revokeOne.isPending && revokeOne.variables === session.id}
                      disabled={revokeOne.isPending || revokeAll.isPending}
                      onClick={() => revokeOne.mutate(session.id)}
                    >
                      Odjavi
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
