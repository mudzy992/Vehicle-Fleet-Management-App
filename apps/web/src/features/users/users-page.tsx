/**
 * Korisnici (W26, docs/06 §5.5; docs/07 §2.2).
 *
 * Šta ekran radi i zašto tako:
 * - **PII maskiranje** je serverska odluka (`piiRedacted`), UI je samo prikazuje;
 *   Super Admin vidi pun e-mail, ostali `a***@firma.ba`.
 * - **Lozinke se prikazuju jednom**: kreiranje vraća `temporaryPassword`, reset
 *   vraća `token` — oba se prikazuju u istaknutoj kutiji i više nikad ne dolaze
 *   iz API-ja (u bazi su hashovi).
 * - **Nema „obriši" dugmeta po redu** bez razloga: `DELETE` je anonimizacija
 *   (nepovratna) i traži `user:delete` (samo Super Admin).
 * - Sve mutacije invalidiraju `users` upit i osvježavaju profil, jer promjena
 *   statusa/rola revokuje sesije (P3).
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateUserResult,
  PasswordResetIssued,
  RoleSummary,
  UserListResponse,
  UserSummary,
} from '@vfm/shared/schemas';
import { USER_STATUSES } from '@vfm/shared';
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

const PAGE_SIZE = 20;

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('bs-BA', { timeZone: 'Europe/Sarajevo' });
}

function statusLevel(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'ACTIVE') return 'success';
  if (status === 'PENDING_PASSWORD_CHANGE') return 'warning';
  if (status === 'SUSPENDED') return 'warning';
  return 'neutral';
}

export function UsersPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useSession();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [issued, setIssued] = useState<{ kind: 'password' | 'token'; email: string; value: string; expiresAt?: string } | null>(
    null,
  );

  const query = useQuery({
    queryKey: ['users', { page, search, status }],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (search.trim()) params.set('q', search.trim());
      if (status) params.set('status', status);
      return api.get<UserListResponse>(`/users?${params.toString()}`);
    },
  });

  const rolesQuery = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<RoleSummary[]>('/roles'),
    staleTime: 60_000,
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['users'] });
  };

  const createUser = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post<CreateUserResult>('/users', payload),
    onSuccess: (result) => {
      setShowCreate(false);
      setIssued({
        kind: 'password',
        email: result.user.email,
        value: result.temporaryPassword,
      });
      refresh();
    },
  });

  const resetPassword = useMutation({
    mutationFn: (id: string) => api.post<PasswordResetIssued>(`/users/${id}/reset-password`, {}),
    onSuccess: (result) => {
      setIssued({ kind: 'token', email: result.email, value: result.token, expiresAt: result.expiresAt });
    },
  });

  const forceLogout = useMutation({
    mutationFn: (id: string) => api.post<{ revokedSessions: number }>(`/users/${id}/force-logout`),
    onSuccess: refresh,
  });

  const archiveUser = useMutation({
    mutationFn: (id: string) => api.post<void>(`/users/${id}/archive`, { reason: 'Arhivirano iz web aplikacije' }),
    onSuccess: refresh,
  });

  const items = query.data?.items ?? [];
  const totalPages = query.data?.totalPages ?? 0;

  const queryErrorMessage =
    query.error instanceof ApiError ? query.error.message : 'Greška pri učitavanju korisnika.';
  const actionErrors = [
    [resetPassword.error, 'Greška pri izdavanju tokena za reset lozinke.'],
    [forceLogout.error, 'Greška pri odjavi korisnika.'],
    [archiveUser.error, 'Greška pri arhiviranju korisnika.'],
  ] as const;

  return (
    <div className="vfm-module-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Pretraga" htmlFor="users-search">
            <input
              id="users-search"
              className={inputClassName}
              placeholder="Ime, prezime ili e-mail"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
          </Field>
          <Field label="Status" htmlFor="users-status">
            <select
              id="users-status"
              className={inputClassName}
              value={status}
              onChange={(event) => {
                setPage(1);
                setStatus(event.target.value);
              }}
            >
              <option value="">Svi</option>
              {USER_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {hasPermission('user:create') ? (
          <Button type="button" variant="primary" onClick={() => setShowCreate((open) => !open)}>
            {showCreate ? 'Zatvori formu' : 'Novi korisnik'}
          </Button>
        ) : null}
      </div>

      {issued ? (
        <Card className="border-[var(--warning,var(--border))]">
          <p className="text-sm font-medium">
            {issued.kind === 'password'
              ? `Privremena lozinka za ${issued.email}`
              : `Jednokratni token za reset lozinke (${issued.email})`}
          </p>
          <p className="mt-1 text-[11px] text-[var(--fg-muted)]">
            Prikazuje se <strong>samo sada</strong>. Predajte je korisniku sigurnim kanalom
            {issued.expiresAt ? `; token važi do ${formatDateTime(issued.expiresAt)}` : ''}. U bazi je samo hash.
          </p>
          <pre className="mt-2 select-all overflow-x-auto rounded-md bg-[var(--surface-muted)] px-3 py-2 text-xs">
            {issued.value}
          </pre>
          <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => setIssued(null)}>
            Sakrij
          </Button>
        </Card>
      ) : null}

      {showCreate ? (
        <CreateUserForm
          roles={rolesQuery.data ?? []}
          pending={createUser.isPending}
          error={createUser.error instanceof ApiError ? createUser.error : null}
          onSubmit={(payload) => createUser.mutate(payload)}
        />
      ) : null}

      {actionErrors.map(([cause, fallback]) =>
        cause ? (
          <p key={fallback} role="alert" className="text-sm text-[var(--danger)]">
            {cause instanceof ApiError ? cause.message : fallback}
          </p>
        ) : null,
      )}

      <Card flush>
        {query.isPending ? (
          <p className="p-4 text-sm text-[var(--fg-muted)]" role="status">Učitavanje…</p>
        ) : query.isError ? (
          <p className="p-4 text-sm text-[var(--danger)]" role="alert">
            {queryErrorMessage}
          </p>
        ) : items.length === 0 ? (
          <div className="p-4">
            <EmptyState title="Nema korisnika" description="Promijenite filter ili kreirajte novog korisnika." />
          </div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Korisnik</TH>
                <TH>E-mail</TH>
                <TH>Role</TH>
                <TH>Status</TH>
                <TH>Zadnja prijava</TH>
                <TH align="right">Akcije</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  canReset={hasPermission('user:reset_password')}
                  canForceLogout={hasPermission('user:force_logout')}
                  canArchive={hasPermission('user:archive')}
                  onReset={() => resetPassword.mutate(user.id)}
                  onForceLogout={() => forceLogout.mutate(user.id)}
                  onArchive={() => archiveUser.mutate(user.id)}
                />
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <div className="flex items-center justify-between text-xs text-[var(--fg-muted)]">
        <span>
          Stranica {page} / {Math.max(totalPages, 1)} · ukupno {query.data?.total ?? 0}
        </span>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Prethodna
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Sljedeća
          </Button>
        </div>
      </div>
    </div>
  );
}

function UserRow({
  user,
  canReset,
  canForceLogout,
  canArchive,
  onReset,
  onForceLogout,
  onArchive,
}: {
  user: UserSummary;
  canReset: boolean;
  canForceLogout: boolean;
  canArchive: boolean;
  onReset: () => void;
  onForceLogout: () => void;
  onArchive: () => void;
}) {
  return (
    <TR>
      <TD>
        <div className="font-medium">
          {user.firstName} {user.lastName}
        </div>
        {user.mustChangePassword ? (
          <span className="text-[11px] text-[var(--fg-muted)]">mora promijeniti lozinku</span>
        ) : null}
      </TD>
      <TD>
        <span className={user.piiRedacted ? 'text-[var(--fg-muted)]' : ''}>{user.email}</span>
      </TD>
      <TD>
        <div className="flex flex-wrap gap-1">
          {user.roles.map((role) => (
            <Badge key={role.id}>{role.code}</Badge>
          ))}
        </div>
      </TD>
      <TD>
        <Badge level={statusLevel(user.status)} dot>
          {user.status}
        </Badge>
      </TD>
      <TD className="text-[11px] text-[var(--fg-muted)]">{formatDateTime(user.lastLoginAt)}</TD>
      <TD align="right">
        <div className="flex justify-end gap-1">
          {canReset ? (
            <Button type="button" size="sm" variant="ghost" onClick={onReset} title="Izdaj token za reset lozinke">
              Reset lozinke
            </Button>
          ) : null}
          {canForceLogout ? (
            <Button type="button" size="sm" variant="ghost" onClick={onForceLogout} title="Prekini sve sesije">
              Odjavi svuda
            </Button>
          ) : null}
          {canArchive ? (
            <Button type="button" size="sm" variant="ghost" onClick={onArchive} title="Arhiviraj (soft delete)">
              Arhiviraj
            </Button>
          ) : null}
        </div>
      </TD>
    </TR>
  );
}

function CreateUserForm({
  roles,
  pending,
  error,
  onSubmit,
}: {
  roles: readonly RoleSummary[];
  pending: boolean;
  error: ApiError | null;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);

  const fieldErrors = useMemo(() => {
    const map = new Map<string, string>();
    for (const detail of error?.details ?? []) {
      const key = detail.path[0];
      if (typeof key === 'string' && !map.has(key)) map.set(key, detail.message);
    }
    return map;
  }, [error]);

  return (
    <Card>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            email: email.trim(),
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            ...(phone.trim() ? { phone: phone.trim() } : {}),
            roleIds,
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="E-mail" htmlFor="new-email" error={fieldErrors.get('email')}>
            <input id="new-email" type="email" required className={inputClassName} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Telefon" htmlFor="new-phone" error={fieldErrors.get('phone')}>
            <input id="new-phone" className={inputClassName} placeholder="+387 61 000 000" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Ime" htmlFor="new-first-name" error={fieldErrors.get('firstName')}>
            <input id="new-first-name" required className={inputClassName} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </Field>
          <Field label="Prezime" htmlFor="new-last-name" error={fieldErrors.get('lastName')}>
            <input id="new-last-name" required className={inputClassName} value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>
        </div>

        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-[var(--fg-muted)]">Role (najmanje jedna)</legend>
          <div className="flex flex-wrap gap-3">
            {roles.map((role) => (
              <label key={role.id} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={roleIds.includes(role.id)}
                  onChange={(event) => {
                    setRoleIds((current) =>
                      event.target.checked ? [...current, role.id] : current.filter((id) => id !== role.id),
                    );
                  }}
                />
                {role.name}
              </label>
            ))}
          </div>
          {fieldErrors.get('roleIds') ? (
            <p role="alert" className="text-[11px] text-[var(--danger)]">
              {fieldErrors.get('roleIds')}
            </p>
          ) : null}
        </fieldset>

        <p className="text-[11px] text-[var(--fg-muted)]">
          Lozinku generiše server i prikazuje je jednom nakon kreiranja; korisnik je mijenja pri prvoj prijavi.
        </p>

        {error && fieldErrors.size === 0 ? (
          <p role="alert" className="text-xs text-[var(--danger)]">
            {error.message} ({error.code})
          </p>
        ) : null}

        <Button type="submit" variant="primary" loading={pending} disabled={pending || roleIds.length === 0}>
          Kreiraj korisnika
        </Button>
      </form>
    </Card>
  );
}
