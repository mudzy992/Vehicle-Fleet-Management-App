import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '../../lib/api.js';
import { FormsPage } from './forms-page.js';

const { permissions } = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('../auth/session.js', () => ({
  useSession: () => ({ hasPermission: (permission: string) => permissions.has(permission) }),
}));

const formId = '88888888-8888-4888-8888-888888888888';
const publishedId = '99999999-9999-4999-8999-999999999999';
const draftId = '77777777-7777-4777-8777-777777777777';

function definition(keys: readonly string[]) {
  return {
    $schema: 'vfm-form/1',
    meta: { title: 'Pregled vozila', subject: 'VEHICLE', language: 'bs' },
    layout: { columns: 1, sectionsCollapsible: true, stickySubmit: true },
    sections: [
      {
        key: 'osnovno',
        title: 'Osnovno',
        order: 1,
        visibleWhen: null,
        fields: keys.map((key, index) => ({
          key,
          type: 'TEXT',
          label: key === 'napomena' ? 'Napomena' : 'Ocjena',
          order: index + 1,
          required: false,
          visibleWhen: null,
          disabled: false,
          visibleOnForm: true,
          storeInFormData: true,
        })),
      },
    ],
  };
}

function versionRow(id: string, version: number, status: 'DRAFT' | 'PUBLISHED') {
  return {
    id,
    version,
    status,
    changeNote: status === 'PUBLISHED' ? 'Prva' : null,
    contentHash: status === 'PUBLISHED' ? 'hash-1' : 'hash-draft',
    mobileCompatible: true,
    publishedAt: status === 'PUBLISHED' ? '2026-01-01T00:00:00.000Z' : null,
    publishedById: status === 'PUBLISHED' ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : null,
    retiredAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    recordCount: 0,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FormsPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  permissions.clear();
  vi.restoreAllMocks();
});

describe('FormsPage — copy then publish', () => {
  it('šalje izmijenjenu definiciju prije objave, čak i bez Sačuvaj nacrt', async () => {
    for (const permission of ['form:view', 'form:update', 'form:manage_schema', 'form:publish_version']) {
      permissions.add(permission);
    }
    const publishedDef = definition(['napomena', 'ocjena']);
    let versions = [versionRow(publishedId, 1, 'PUBLISHED')];
    let draftDef = structuredClone(publishedDef);

    vi.spyOn(api, 'get').mockImplementation(async (path) => {
      if (path === '/form-schemas') {
        return [
          {
            id: formId,
            key: 'pregled_vozila',
            name: 'Pregled vozila',
            subject: 'VEHICLE',
            taskTypeId: null,
            role: null,
            description: null,
            ownerModule: 'vehicles',
            status: 'PUBLISHED',
            currentPublishedVersionId: publishedId,
            currentPublishedVersion: 1,
            versionCount: versions.length,
            updatedAt: '2026-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ] as never;
      }
      if (path === `/form-schemas/${formId}`) {
        return {
          id: formId,
          key: 'pregled_vozila',
          name: 'Pregled vozila',
          subject: 'VEHICLE',
          taskTypeId: null,
          description: null,
          ownerModule: 'vehicles',
          status: 'PUBLISHED',
          currentPublishedVersionId: publishedId,
          currentPublishedVersion: 1,
          versionCount: versions.length,
          updatedAt: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          versions,
        } as never;
      }
      if (path.endsWith(draftId)) {
        return { ...versionRow(draftId, 2, 'DRAFT'), formSchemaId: formId, definition: draftDef, normalizedName: null } as never;
      }
      return {
        ...versionRow(publishedId, 1, 'PUBLISHED'),
        formSchemaId: formId,
        definition: publishedDef,
        normalizedName: null,
      } as never;
    });

    const put = vi.spyOn(api, 'put').mockImplementation(async (_path, input) => {
      draftDef = (input as { definition: typeof publishedDef }).definition;
      return { ...versionRow(draftId, 2, 'DRAFT'), formSchemaId: formId, definition: draftDef, normalizedName: null } as never;
    });
    const post = vi.spyOn(api, 'post').mockImplementation(async (path) => {
      if (path === `/form-schemas/${formId}/versions`) {
        versions = [versionRow(draftId, 2, 'DRAFT'), versionRow(publishedId, 1, 'PUBLISHED')];
        draftDef = structuredClone(publishedDef);
        return { ...versionRow(draftId, 2, 'DRAFT'), formSchemaId: formId, definition: draftDef, normalizedName: null } as never;
      }
      return { ...versionRow(draftId, 2, 'PUBLISHED'), formSchemaId: formId, definition: draftDef, normalizedName: null } as never;
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Nova verzija' }));
    expect(await screen.findByText('Kreirana verzija 2 (nacrt).')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Ukloni Napomena' }));
    fireEvent.change(screen.getByLabelText(/Bilješka o promjeni/u), { target: { value: 'Uklonjena napomena' } });
    fireEvent.click(screen.getByRole('button', { name: 'Objavi…' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    await screen.findByText('Verzija je objavljena; prethodna aktivna je povučena.');

    const saved = put.mock.lastCall?.[1] as { definition: typeof publishedDef };
    const savedKeys = saved.definition.sections[0]!.fields.map((field) => field.key);
    expect(savedKeys).toEqual(['ocjena']);
    expect(post.mock.calls.some((call) => String(call[0]).endsWith('/publish'))).toBe(true);
  });

  it('šalje confirmNormalizedRemoval kad se ukloni mapirano polje', async () => {
    for (const permission of ['form:view', 'form:update', 'form:manage_schema', 'form:publish_version']) {
      permissions.add(permission);
    }
    const publishedDef = {
      ...definition(['napomena', 'ocjena']),
      normalizedName: [{ fieldKey: 'napomena', column: 'plateNumber', transform: 'TO_TEXT' }],
    };
    let versions = [versionRow(publishedId, 1, 'PUBLISHED')];
    let draftDef = structuredClone(publishedDef);

    vi.spyOn(api, 'get').mockImplementation(async (path) => {
      if (path === '/form-schemas') {
        return [
          {
            id: formId,
            key: 'pregled_vozila',
            name: 'Pregled vozila',
            subject: 'VEHICLE',
            taskTypeId: null,
            role: null,
            description: null,
            ownerModule: 'vehicles',
            status: 'PUBLISHED',
            currentPublishedVersionId: publishedId,
            currentPublishedVersion: 1,
            versionCount: versions.length,
            updatedAt: '2026-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ] as never;
      }
      if (path === `/form-schemas/${formId}`) {
        return {
          id: formId,
          key: 'pregled_vozila',
          name: 'Pregled vozila',
          subject: 'VEHICLE',
          taskTypeId: null,
          description: null,
          ownerModule: 'vehicles',
          status: 'PUBLISHED',
          currentPublishedVersionId: publishedId,
          currentPublishedVersion: 1,
          versionCount: versions.length,
          updatedAt: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          versions,
        } as never;
      }
      if (path.endsWith(draftId)) {
        return { ...versionRow(draftId, 2, 'DRAFT'), formSchemaId: formId, definition: draftDef, normalizedName: null } as never;
      }
      return {
        ...versionRow(publishedId, 1, 'PUBLISHED'),
        formSchemaId: formId,
        definition: publishedDef,
        normalizedName: null,
      } as never;
    });

    vi.spyOn(api, 'put').mockImplementation(async (_path, input) => {
      draftDef = (input as { definition: typeof publishedDef }).definition;
      return { ...versionRow(draftId, 2, 'DRAFT'), formSchemaId: formId, definition: draftDef, normalizedName: null } as never;
    });
    const post = vi.spyOn(api, 'post').mockImplementation(async (path) => {
      if (path === `/form-schemas/${formId}/versions`) {
        versions = [versionRow(draftId, 2, 'DRAFT'), versionRow(publishedId, 1, 'PUBLISHED')];
        draftDef = structuredClone(publishedDef);
        return { ...versionRow(draftId, 2, 'DRAFT'), formSchemaId: formId, definition: draftDef, normalizedName: null } as never;
      }
      return { ...versionRow(draftId, 2, 'PUBLISHED'), formSchemaId: formId, definition: draftDef, normalizedName: null } as never;
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Nova verzija' }));
    expect(await screen.findByText('Kreirana verzija 2 (nacrt).')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Ukloni Napomena' }));
    fireEvent.change(screen.getByLabelText(/Bilješka o promjeni/u), { target: { value: 'Samo ocjena' } });
    const confirm = await screen.findByRole('checkbox', { name: /Potvrđujem uklanjanje mapiranih polja/u });
    fireEvent.click(screen.getByRole('button', { name: 'Objavi…' }));
    expect(await screen.findByText(/Potvrdite uklanjanje mapiranih polja prije objave/u)).toBeTruthy();
    expect(post.mock.calls.some((call) => String(call[0]).endsWith('/publish'))).toBe(false);

    fireEvent.click(confirm);
    fireEvent.click(screen.getByRole('button', { name: 'Objavi…' }));
    await screen.findByText('Verzija je objavljena; prethodna aktivna je povučena.');
    const publishCall = post.mock.calls.find((call) => String(call[0]).endsWith('/publish'));
    expect(publishCall?.[1]).toEqual({
      changeNote: 'Samo ocjena',
      confirmNormalizedRemoval: true,
    });
  });
});
