import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FcmMessage } from '../../src/infra/queue/fcm-delivery-processor.js';

const firebase = vi.hoisted(() => ({
  getApps: vi.fn(),
  cert: vi.fn((account: unknown) => account),
  initializeApp: vi.fn(),
  getMessaging: vi.fn(),
  send: vi.fn(),
}));

vi.mock('firebase-admin/app', () => ({
  getApps: firebase.getApps,
  cert: firebase.cert,
  initializeApp: firebase.initializeApp,
}));
vi.mock('firebase-admin/messaging', () => ({ getMessaging: firebase.getMessaging }));

import { FirebaseAdminFcmGateway } from '../../src/infra/queue/firebase-admin-fcm.gateway.js';

const MESSAGE: FcmMessage = {
  notificationId: '11111111-1111-4111-8111-111111111111',
  title: 'Zadatak preuzet',
  body: 'Zadatak T-1 je preuzet.',
  data: { secretLikePayloadField: 'must-not-leak' },
  linkToType: 'TASK',
  linkToId: '22222222-2222-4222-8222-222222222222',
  token: 'test-token-only',
};

let tempDirectory: string | undefined;

async function accountPath(): Promise<string> {
  tempDirectory = await mkdtemp(join(tmpdir(), 'vfm-fcm-test-'));
  const path = join(tempDirectory, 'service-account.json');
  await writeFile(
    path,
    JSON.stringify({ project_id: 'vfm-test-project', client_email: 'ci@example.invalid' }),
  );
  return path;
}

function gateway(path: string | undefined): FirebaseAdminFcmGateway {
  return new FirebaseAdminFcmGateway({
    FIREBASE_PROJECT_ID: 'vfm-test-project',
    FIREBASE_SERVICE_ACCOUNT_PATH: path,
    FCM_ANDROID_PACKAGE: 'ba.test.vfm',
    FCM_MESSAGE_TTL_SECONDS: 3600,
  } as never);
}

describe('FirebaseAdminFcmGateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firebase.getApps.mockReturnValue([]);
    firebase.initializeApp.mockImplementation((_options: unknown, name: string) => ({ name }));
    firebase.getMessaging.mockReturnValue({ send: firebase.send });
    firebase.send.mockResolvedValue('projects/vfm-test-project/messages/mock-id');
  });

  afterEach(async () => {
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
    tempDirectory = undefined;
  });

  it('lazy-loads the mounted service account and sends only the notification routing data', async () => {
    const path = await accountPath();
    const adapter = gateway(path);
    await expect(adapter.send(MESSAGE)).resolves.toBe('projects/vfm-test-project/messages/mock-id');
    await adapter.send(MESSAGE);

    expect(firebase.initializeApp).toHaveBeenCalledTimes(1);
    expect(firebase.initializeApp).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'vfm-test-project' }),
      'vfm-notification-worker',
    );
    expect(firebase.send).toHaveBeenCalledWith({
      token: 'test-token-only',
      notification: { title: 'Zadatak preuzet', body: 'Zadatak T-1 je preuzet.' },
      data: {
        notificationId: MESSAGE.notificationId,
        linkToType: 'TASK',
        linkToId: MESSAGE.linkToId,
        route: `vfm://tasks/${MESSAGE.linkToId}`,
      },
      android: {
        restrictedPackageName: 'ba.test.vfm',
        priority: 'high',
        ttl: 3_600_000,
      },
    });
    expect(JSON.stringify(firebase.send.mock.calls)).not.toContain('must-not-leak');
  });

  it('uses an already initialized named Firebase app', async () => {
    firebase.getApps.mockReturnValue([{ name: 'vfm-notification-worker' }]);
    const adapter = gateway(await accountPath());
    await adapter.send(MESSAGE);
    expect(firebase.initializeApp).not.toHaveBeenCalled();
    expect(firebase.send).toHaveBeenCalledTimes(1);
  });

  it('returns safe configuration/file errors without including credential contents', async () => {
    await expect(gateway(undefined).send(MESSAGE)).rejects.toThrow(
      'FCM je uključen, ali Firebase projekat ili putanja service-account fajla nisu postavljeni.',
    );
    await expect(gateway('/not/a/real/service-account.json').send(MESSAGE)).rejects.toThrow(
      'Firebase service-account fajl nije moguće učitati ili parsirati.',
    );
  });
});
