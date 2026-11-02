import { useEffect, useState } from 'react';
import { BareButton } from '../../components/ui/index.js';
import { api } from '../../lib/api.js';

export function AttachmentGallery({
  ids,
  kind,
  onRemove,
}: {
  ids: string[];
  kind: 'PHOTO' | 'FILE';
  onRemove?(id: string): void;
}) {
  const [sources, setSources] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    const created: string[] = [];
    void Promise.all(ids.map(async (id) => {
      if (sources[id]) return;
      try {
        if (kind !== 'PHOTO') {
          if (active) setSources((current) => ({ ...current, [id]: '' }));
          return;
        }
        const blob = await api.downloadUrl(`/api/v1/attachments/${id}/content`);
        const objectUrl = URL.createObjectURL(blob);
        created.push(objectUrl);
        if (active) setSources((current) => ({ ...current, [id]: objectUrl }));
      } catch {
        if (active) setSources((current) => ({ ...current, [id]: '' }));
      }
    }));
    return () => {
      active = false;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [ids.join('|'), kind]);
  if (ids.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {ids.map((id) => (
        <figure key={id} className="w-24 space-y-1">
          {kind === 'PHOTO' && sources[id] ? (
            <a href={sources[id]} target="_blank" rel="noreferrer">
              <img alt="Priložena fotografija" className="h-24 w-24 rounded-md object-cover" src={sources[id]} />
            </a>
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-md border border-border bg-surface-muted text-center text-xs text-fg-muted">
              {kind === 'FILE' ? 'Datoteka' : sources[id] === undefined ? 'Učitavanje…' : 'Slika'}
            </div>
          )}
          {onRemove ? (
            <BareButton className="w-full text-xs text-danger" onClick={() => onRemove(id)}>
              Ukloni
            </BareButton>
          ) : null}
        </figure>
      ))}
    </div>
  );
}
