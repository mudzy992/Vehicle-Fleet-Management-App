import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { APP_NAME } from '@vfm/shared';
import { ApiError } from '../../lib/api.js';
import { buttonClassName, Card } from '../../components/ui/index.js';
import { fetchLatestAppRelease, formatBytes } from './app-releases-api.js';

export function PublicLandingPage() {
  const latest = useQuery({
    queryKey: ['app-releases', 'latest'],
    queryFn: fetchLatestAppRelease,
    retry: false,
  });
  const release = latest.data;
  const missing = latest.isError && latest.error instanceof ApiError && latest.error.status === 404;

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
            Mobilna aplikacija.
            <br />
            <span>Uvijek zadnja verzija.</span>
          </h2>
          <p>Preuzmite Android APK ili se prijavite u web radni prostor.</p>
        </div>
        <p className="vfm-login-footnote">Javni katalog izdanja · bs-BA</p>
      </section>
      <section className="vfm-login-panel" aria-labelledby="landing-title">
        <div className="vfm-login-form-wrap">
          <p className="vfm-eyebrow">ANDROID</p>
          <h1 id="landing-title" className="vfm-login-title">
            {APP_NAME}
          </h1>
          <p className="vfm-login-subtitle">Zadnje izdanje mobilne aplikacije i prijava u sistem.</p>
          <Card className="vfm-login-card space-y-4 p-5">
            {release ? (
              <div className="space-y-3">
                <p className="text-sm text-fg">
                  Verzija {release.versionName}{' '}
                  <span className="text-fg-muted">({release.versionCode})</span>
                </p>
                <p className="text-sm text-fg-muted">{formatBytes(release.sizeBytes)}</p>
                {release.releaseNotes ? <p className="text-sm text-fg">{release.releaseNotes}</p> : null}
                <a
                  className={`${buttonClassName('primary')} w-full`}
                  href={release.downloadUrl}
                  download
                >
                  Preuzmi APK
                </a>
              </div>
            ) : (
              <p className="text-sm text-fg-muted">
                {missing || latest.isError
                  ? 'APK još nije objavljen. Prijavite se u web aplikaciju.'
                  : 'Provjeravam zadnje izdanje…'}
              </p>
            )}
            <Link to="/prijava" className="inline-flex text-sm font-medium text-primary">
              Prijava
            </Link>
          </Card>
        </div>
      </section>
    </main>
  );
}
