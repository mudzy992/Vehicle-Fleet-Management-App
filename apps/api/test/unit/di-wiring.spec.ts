import { TiresService } from '../../src/modules/tires/tires.service.js';
import { TireSetsController } from '../../src/modules/tires/tires.controller.js';
import { TireInstallationsService } from '../../src/modules/tires/tire-installations.service.js';
import { TireInstallationsController } from '../../src/modules/tires/tire-installations.controller.js';
import { ServiceItemsService } from '../../src/modules/services/service-items.service.js';
import { ServiceItemsController } from '../../src/modules/services/service-items.controller.js';
import { ServicesService } from '../../src/modules/services/services.service.js';
import { ServicesController } from '../../src/modules/services/services.controller.js';
/**
 * DI wiring — regresija za pad u produkciji (Faza 3).
 *
 * Deploy je pao na startu s:
 *
 *   Nest can't resolve dependencies of the AttachmentsService (PrismaService, ?)
 *
 * Uzrok: konstruktor je tražio **interfejs** (`Partial<AttachmentStorageOptions>`)
 * koji ne postoji u runtime-u, a nije imao `@Inject` token. Jedinični testovi to
 * ne vide jer servis instanciraju direktno (`new AttachmentsService(fake, opts)`).
 *
 * Ovaj test zato **bootuje Nest modul** za svaki servis/kontroler Faze 3: ako
 * metapodaci za injekciju nisu potpuni, padne ovdje — ne na deployu.
 */
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { Provider } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { IdempotencyInterceptor } from '../../src/common/interceptors/idempotency.interceptor.js';
import { IdempotencyService } from '../../src/infra/redis/idempotency.service.js';
import { AttachmentsService } from '../../src/modules/attachments/attachments.service.js';
import { AttachmentsController } from '../../src/modules/attachments/attachments.controller.js';
import { VehiclesService } from '../../src/modules/vehicles/vehicles.service.js';
import { VehiclesController } from '../../src/modules/vehicles/vehicles.controller.js';
import { DriversService } from '../../src/modules/drivers/drivers.service.js';
import { DriversController } from '../../src/modules/drivers/drivers.controller.js';
import { RegistrationsService } from '../../src/modules/registrations/registrations.service.js';
import { RegistrationsController } from '../../src/modules/registrations/registrations.controller.js';
import { InsurancesService } from '../../src/modules/insurances/insurances.service.js';
import { InsurancesController } from '../../src/modules/insurances/insurances.controller.js';
import { RemindersService } from '../../src/modules/reminders/reminders.service.js';
import { RemindersController } from '../../src/modules/reminders/reminders.controller.js';

const prismaProvider: Provider = { provide: PrismaService, useValue: {} };

const services = [
  ['TireInstallationsService', TireInstallationsService],
  ['TiresService', TiresService],
  ['ServiceItemsService', ServiceItemsService],
  ['ServicesService', ServicesService],
  ['AttachmentsService', AttachmentsService],
  ['VehiclesService', VehiclesService],
  ['DriversService', DriversService],
  ['RegistrationsService', RegistrationsService],
  ['InsurancesService', InsurancesService],
  ['RemindersService', RemindersService],
] as const;

const controllers = [
  ['TireInstallationsController', TireInstallationsController, TireInstallationsService],
  ['TireSetsController', TireSetsController, TiresService],
  ['ServiceItemsController', ServiceItemsController, ServiceItemsService],
  ['ServicesController', ServicesController, ServicesService],
  ['AttachmentsController', AttachmentsController, AttachmentsService],
  ['VehiclesController', VehiclesController, VehiclesService],
  ['DriversController', DriversController, DriversService],
  ['RegistrationsController', RegistrationsController, RegistrationsService],
  ['InsurancesController', InsurancesController, InsurancesService],
  ['RemindersController', RemindersController, RemindersService],
] as const;

describe('DI wiring (Faza 3)', () => {
  it.each(services)('%s se može instancirati kroz Nest', async (_name, service) => {
    const moduleRef = await Test.createTestingModule({
      providers: [service as never, prismaProvider],
    }).compile();

    expect(moduleRef.get(service as never)).toBeTruthy();
    await moduleRef.close();
  });

  it.each(controllers)('%s dobija svoj servis kroz Nest', async (_name, controller, service) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [controller as never],
      providers: [{ provide: service as never, useValue: {} }],
    }).compile();

    expect(moduleRef.get(controller as never)).toBeTruthy();
    await moduleRef.close();
  });

  it('IdempotencyInterceptor dobija servis i Reflector kroz Nest', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        IdempotencyInterceptor,
        { provide: IdempotencyService, useValue: {} },
        { provide: Reflector, useValue: new Reflector() },
      ],
    }).compile();

    expect(moduleRef.get(IdempotencyInterceptor)).toBeInstanceOf(IdempotencyInterceptor);
    await moduleRef.close();
  });

  it('AttachmentsService ne traži konfiguraciju kao obavezan parametar', async () => {
    // Bez ovoga bi produkcija ponovo pala na `index [1]` — opcioni token smije
    // ostati neriješen, ali konstruktor mora proći.
    const moduleRef = await Test.createTestingModule({
      providers: [AttachmentsService, prismaProvider],
    }).compile();

    const instance = moduleRef.get(AttachmentsService);
    expect(instance).toBeInstanceOf(AttachmentsService);
    await moduleRef.close();
  });
});
