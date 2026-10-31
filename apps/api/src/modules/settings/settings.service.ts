import { Injectable } from '@nestjs/common';
import type { AppSettingView } from '@vfm/shared/schemas';
import { VfmErrors } from '../../common/errors/vfm-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SETTINGS_REGISTRY, type SettingDefinition } from './settings.registry.js';

function asView(row: {
  key: string;
  value: unknown;
  valueType: string;
  scope: string;
  description: string;
  updatedAt: Date;
}): AppSettingView {
  return {
    key: row.key,
    value: row.value as boolean | number | string,
    valueType: row.valueType as AppSettingView['valueType'],
    scope: row.scope as AppSettingView['scope'],
    description: row.description,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(includePrivate: boolean): Promise<AppSettingView[]> {
    await this.ensureDefaults();
    const rows = await this.prisma.appSetting.findMany({
      where: includePrivate ? undefined : { scope: 'public' },
      orderBy: { key: 'asc' },
    });
    return rows.map(asView);
  }

  async update(key: string, value: boolean | number | string): Promise<AppSettingView> {
    await this.ensureDefaults();
    const definition = SETTINGS_REGISTRY.find((item) => item.key === key);
    if (!definition) throw VfmErrors.notFound('Postavka nije pronađena.');
    this.assertType(definition, value);
    const row = await this.prisma.appSetting.update({
      where: { key },
      data: { value, description: definition.description, valueType: definition.valueType, scope: definition.scope },
    });
    return asView(row);
  }

  private assertType(definition: SettingDefinition, value: boolean | number | string): void {
    const actual = typeof value;
    if (actual !== definition.valueType) {
      throw VfmErrors.validationError([
        { path: ['value'], message: `Očekivan ${definition.valueType}, dobijen ${actual}.` },
      ]);
    }
  }

  private async ensureDefaults(): Promise<void> {
    for (const item of SETTINGS_REGISTRY) {
      await this.prisma.appSetting.upsert({
        where: { key: item.key },
        update: { description: item.description, valueType: item.valueType, scope: item.scope },
        create: {
          key: item.key,
          value: item.defaultValue,
          valueType: item.valueType,
          scope: item.scope,
          description: item.description,
        },
      });
    }
  }
}
