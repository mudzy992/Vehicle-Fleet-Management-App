import { useCallback, useEffect, useState, type PropsWithChildren } from 'react';
import { AppState, Modal, StyleSheet, Text, View } from 'react-native';
import * as Application from 'expo-application';
import type { Socket } from 'socket.io-client';
import { AppButton } from '@/ui/button';
import { colors, space, type } from '@/lib/theme';
import { fetchLatestRelease } from './fetch-latest-release';
import { downloadAndInstallApk, isStandaloneBuild, openLandingPage } from './install-apk';
import { needsForceUpdate, type AppReleaseLatest } from './app-release-types';

export function ForceUpdateGate({ children }: PropsWithChildren) {
  const [latest, setLatest] = useState<AppReleaseLatest | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const localVersion = Number(Application.nativeBuildVersion ?? 0);
  const blocked = latest !== null && needsForceUpdate(localVersion, latest.versionCode);

  const refresh = useCallback(async () => {
    const next = await fetchLatestRelease();
    setLatest(next);
  }, []);

  useEffect(() => {
    void refresh();
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    let socket: Socket | null = null;
    void import('socket.io-client').then(({ io }) => {
      const origin = process.env.EXPO_PUBLIC_API_URL?.replace(/\/api\/v1\/?$/u, '') ?? '';
      if (!origin) return;
      socket = io(`${origin}/realtime`, { transports: ['websocket'] });
      socket.on('refresh', (payload: { topic?: string }) => {
        if (payload.topic === 'app-releases') void refresh();
      });
    });
    return () => {
      app.remove();
      socket?.disconnect();
    };
  }, [refresh]);

  const handleUpdate = async (): Promise<void> => {
    if (!latest) return;
    setError(null);
    if (!isStandaloneBuild()) {
      await openLandingPage();
      return;
    }
    setBusy(true);
    try {
      await downloadAndInstallApk({
        versionCode: latest.versionCode,
        sha256: latest.sha256,
        onProgress: setProgress,
      });
    } catch {
      setError('Dozvolite instalaciju iz ove aplikacije u postavkama sistema, zatim pokušajte ponovo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {children}
      <Modal visible={blocked} animationType="fade" onRequestClose={() => undefined}>
        <View style={styles.screen} accessibilityViewIsModal>
          <Text style={styles.title}>Potrebno je ažuriranje</Text>
          <Text style={styles.copy}>
            Instalirana verzija {Number.isFinite(localVersion) ? localVersion : '—'} nije više podržana.
            Nova verzija je {latest?.versionName} ({latest?.versionCode}).
          </Text>
          {latest?.releaseNotes ? <Text style={styles.notes}>{latest.releaseNotes}</Text> : null}
          {busy ? <Text style={styles.copy}>Preuzimanje… {Math.round(progress * 100)}%</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <AppButton
            label={isStandaloneBuild() ? 'Preuzmi i instaliraj' : 'Otvori naslovnu'}
            onPress={() => void handleUpdate()}
            loading={busy}
            disabled={busy}
          />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    padding: space[6],
    justifyContent: 'center',
    gap: space[4],
  },
  title: { ...type.xxl, color: colors.ink, fontWeight: '700' },
  copy: { ...type.base, color: colors.muted },
  notes: { ...type.base, color: colors.ink },
  error: { ...type.base, color: colors.danger },
});
