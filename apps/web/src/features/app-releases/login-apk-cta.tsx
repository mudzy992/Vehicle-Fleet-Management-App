import { useQuery } from '@tanstack/react-query';
import { buttonClassName } from '../../components/ui/index.js';
import { fetchLatestAppRelease, formatBytes } from './app-releases-api.js';

export function LoginApkCta() {
  const latest = useQuery({
    queryKey: ['app-releases', 'latest'],
    queryFn: fetchLatestAppRelease,
    retry: false,
  });
  const release = latest.data;
  if (!release) return null;
  return (
    <div className="mt-5 space-y-2">
      <p className="text-sm text-fg-muted">
        Android aplikacija {release.versionName} ({formatBytes(release.sizeBytes)})
      </p>
      <a
        className={`${buttonClassName('secondary')} w-full`}
        href={release.downloadUrl}
        download
      >
        Preuzmi APK
      </a>
    </div>
  );
}
