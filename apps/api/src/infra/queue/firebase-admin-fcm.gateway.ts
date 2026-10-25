import { readFile } from 'node:fs/promises';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { BaseEnv } from '@vfm/shared/env';
import type { FcmGateway, FcmMessage } from './fcm-delivery-processor.js';

/** Firebase Admin adapter; credentials are read only when delivery is enabled and needed. */
export class FirebaseAdminFcmGateway implements FcmGateway {
  private appPromise: Promise<App> | undefined;

  constructor(
    private readonly env: Pick<
      BaseEnv,
      | 'FIREBASE_PROJECT_ID'
      | 'FIREBASE_SERVICE_ACCOUNT_PATH'
      | 'FCM_ANDROID_PACKAGE'
      | 'FCM_MESSAGE_TTL_SECONDS'
    >,
  ) {}

  async send(message: FcmMessage): Promise<string> {
    const app = await this.getApp();
    const route =
      message.linkToType && message.linkToId
        ? `vfm://${message.linkToType.toLowerCase()}s/${message.linkToId}`
        : '';
    const response = await getMessaging(app).send({
      token: message.token,
      notification: {
        title: message.title,
        ...(message.body ? { body: message.body } : {}),
      },
      data: {
        notificationId: message.notificationId,
        linkToType: message.linkToType ?? '',
        linkToId: message.linkToId ?? '',
        route,
      },
      android: {
        restrictedPackageName: this.env.FCM_ANDROID_PACKAGE,
        priority: 'high',
        ttl: this.env.FCM_MESSAGE_TTL_SECONDS * 1000,
      },
    });
    return response;
  }

  private getApp(): Promise<App> {
    if (!this.appPromise) this.appPromise = this.initializeApp();
    return this.appPromise;
  }

  private async initializeApp(): Promise<App> {
    const projectId = this.env.FIREBASE_PROJECT_ID;
    const serviceAccountPath = this.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (!projectId || !serviceAccountPath) {
      throw new Error(
        'FCM je uključen, ali Firebase projekat ili putanja service-account fajla nisu postavljeni.',
      );
    }

    const existing = getApps().find((app) => app.name === 'vfm-notification-worker');
    if (existing) return existing;

    let serviceAccount: unknown;
    try {
      serviceAccount = JSON.parse(await readFile(serviceAccountPath, 'utf8'));
    } catch {
      // Namjerno bez putanje, sadržaja fajla ili detalja parsera u log poruci.
      throw new Error('Firebase service-account fajl nije moguće učitati ili parsirati.');
    }
    if (typeof serviceAccount !== 'object' || serviceAccount === null) {
      throw new Error('Firebase service-account fajl nema očekivani JSON objekat.');
    }

    return initializeApp(
      { credential: cert(serviceAccount as Parameters<typeof cert>[0]), projectId },
      'vfm-notification-worker',
    );
  }
}
