import { useState, type FormEvent } from 'react';
import { Button, Field, inputClassName } from '../../components/ui/index.js';

interface AppReleaseUploadFormProps {
  readonly busy: boolean;
  readonly onSubmitFile: (file: File, releaseNotes: string) => void;
}

export function AppReleaseUploadForm({ busy, onSubmitFile }: AppReleaseUploadFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [releaseNotes, setReleaseNotes] = useState('');

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!file) return;
    onSubmitFile(file, releaseNotes);
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <Field label="APK fajl" htmlFor="apk-file">
        <input
          id="apk-file"
          className={inputClassName}
          type="file"
          accept=".apk,application/vnd.android.package-archive"
          required
          disabled={busy}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </Field>
      <Field label="Napomena izdanja" htmlFor="apk-notes">
        <textarea
          id="apk-notes"
          className={inputClassName}
          rows={4}
          maxLength={2000}
          value={releaseNotes}
          disabled={busy}
          onChange={(event) => setReleaseNotes(event.target.value)}
        />
      </Field>
      <Button type="submit" variant="primary" loading={busy} disabled={busy || !file}>
        Objavi APK
      </Button>
    </form>
  );
}
