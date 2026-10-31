import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_CLIENT_TYPES_KEY,
  IS_PUBLIC_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from '../../src/common/decorators/auth.decorators.js';
import { RATE_LIMIT_METADATA_KEY } from '../../src/common/rate-limit/rate-limit.decorator.js';
import { AppReleasesController } from '../../src/modules/app-releases/app-releases.controller.js';

describe('AppReleasesController — metadata', () => {
  it('latest i file su javni; mutacije nisu', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AppReleasesController.prototype.latest)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AppReleasesController.prototype.latestFile)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AppReleasesController.prototype.list)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AppReleasesController.prototype.upload)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AppReleasesController.prototype.activate)).toBeUndefined();
  });

  it('admin rute traže app_release:manage i samo WEB', () => {
    for (const handler of [
      AppReleasesController.prototype.list,
      AppReleasesController.prototype.upload,
      AppReleasesController.prototype.activate,
    ]) {
      expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler)).toMatchObject({
        permissions: ['app_release:manage'],
      });
      expect(Reflect.getMetadata(ALLOWED_CLIENT_TYPES_KEY, handler)).toEqual(['WEB']);
    }
  });

  it('upload ima upload limiter', () => {
    expect(Reflect.getMetadata(RATE_LIMIT_METADATA_KEY, AppReleasesController.prototype.upload)).toMatchObject({
      scope: 'upload',
    });
  });
});
