import 'reflect-metadata';
import { HttpCode, HttpStatus, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import {
  IdempotencyInterceptor,
  containsSensitiveIdempotencyField,
} from '../../src/common/interceptors/idempotency.interceptor.js';
import { VfmErrors, VfmException } from '../../src/common/errors/vfm-error.js';
import type { AuthenticatedUser, VfmRequest } from '../../src/common/types/authenticated-user.js';
import {
  hashPayload,
  IdempotencyService,
  type IdempotencyRecord,
} from '../../src/infra/redis/idempotency.service.js';
import {
  FakeRedis,
  FakeResponse,
  USER_ADMIN,
  USER_DRIVER,
  authenticatedUser,
  fakeExecutionContext,
  fakeRedisService,
  fakeRequest,
} from '../helpers/rbac-fakes.js';

/**
 * Globalni `Idempotency-Key` replay (P-06, docs/07 §1.4).
 *
 * Testovi koriste in-memory Redis lažnjak: dokazuju ugovor servisa i
 * interceptora, ali ne stvarnu Redis konkurenciju ni HTTP tok kroz Nest.
 */

const KEY = '018f0000-0000-7000-8000-000000000101';
const KEY_2 = '018f0000-0000-7000-8000-000000000102';

class DummyController {
  @HttpCode(HttpStatus.OK)
  create(): void {}

  @HttpCode(HttpStatus.NO_CONTENT)
  remove(): void {}
}

interface Counter {
  calls: number;
}

function setup(): {
  redis: FakeRedis;
  service: IdempotencyService;
  interceptor: IdempotencyInterceptor;
} {
  const redis = new FakeRedis();
  const service = new IdempotencyService(fakeRedisService(redis));
  return { redis, service, interceptor: new IdempotencyInterceptor(service, new Reflector()) };
}

function onlyRecord(redis: FakeRedis): IdempotencyRecord {
  const keys = redis.keys();
  expect(keys).toHaveLength(1);
  return JSON.parse(redis.store.get(keys[0]!)!) as IdempotencyRecord;
}

function requestFor(
  options: {
    method?: string;
    url?: string;
    body?: unknown;
    user?: AuthenticatedUser | null;
    key?: string | string[] | null;
    headers?: Record<string, string | string[] | undefined>;
  } = {},
): VfmRequest {
  const user = options.user === undefined ? authenticatedUser() : (options.user ?? undefined);
  const key = options.key === undefined ? KEY : options.key;
  const request = fakeRequest({
    method: options.method ?? 'POST',
    url: options.url ?? '/api/v1/vehicles',
    user,
    headers: {
      'content-type': 'application/json',
      ...(key === null ? {} : { 'idempotency-key': key }),
      ...options.headers,
    },
  });
  Object.assign(request, { body: 'body' in options ? options.body : { plate: 'A01-A-001', year: 2024 } });
  return request;
}

function contextFor(
  request: VfmRequest,
  response = new FakeResponse(),
  handler: keyof DummyController = 'create',
): { context: ExecutionContext; response: FakeResponse } {
  return {
    context: fakeExecutionContext({
      handler: DummyController.prototype[handler] as (...args: never[]) => unknown,
      controller: DummyController,
      request,
      response,
    }),
    response,
  };
}

async function invoke(
  interceptor: IdempotencyInterceptor,
  context: ExecutionContext,
  next: CallHandler,
): Promise<unknown> {
  return firstValueFrom(await interceptor.intercept(context, next));
}

function countingHandler(counter: Counter, value: (call: number) => unknown): CallHandler {
  return {
    handle: () => {
      counter.calls += 1;
      return of(value(counter.calls));
    },
  } as CallHandler;
}

describe('hashPayload', () => {
  it('isti JSON s drugim redoslijedom ključeva ima isti hash; redoslijed niza je bitan', () => {
    expect(hashPayload({ b: 2, a: { d: 4, c: 3 } })).toBe(hashPayload({ a: { c: 3, d: 4 }, b: 2 }));
    expect(hashPayload({ ids: ['a', 'b'] })).not.toBe(hashPayload({ ids: ['b', 'a'] }));
  });
});

describe('IdempotencyService', () => {
  it('rezerviše novi ključ na pet minuta i vraća token vlasnika', async () => {
    const { redis, service } = setup();

    const decision = await service.reserve(USER_ADMIN, KEY, { plate: 'A01-A-001' });

    expect(decision.action).toBe('execute');
    expect(decision.reservationToken).toBeTruthy();
    expect(onlyRecord(redis)).toMatchObject({
      state: 'in-progress',
      requestHash: decision.requestHash,
      reservationToken: decision.reservationToken,
    });
    expect([...redis.ttls.values()]).toEqual([300]);
  });

  it('complete čuva requestHash zahtjeva (ne odgovora), pa isti retry replaya odgovor', async () => {
    const { redis, service } = setup();
    const payload = { plate: 'A01-A-001' };
    const responseBody = { id: 'vehicle-1', plate: 'A01-A-001' };
    const decision = await service.reserve(USER_ADMIN, KEY, payload);

    await expect(
      service.complete(USER_ADMIN, KEY, decision.reservationToken!, decision.requestHash, 201, responseBody),
    ).resolves.toBe(true);

    const record = onlyRecord(redis);
    expect(record).toMatchObject({ state: 'completed', status: 201, body: responseBody });
    expect(record.requestHash).toBe(decision.requestHash);
    expect(record.requestHash).not.toBe(hashPayload(responseBody));
    expect([...redis.ttls.values()]).toEqual([24 * 3600]);

    const replay = await service.reserve(USER_ADMIN, KEY, payload);
    expect(replay.action).toBe('replay');
    expect(replay.record?.body).toEqual(responseBody);
  });

  it('isti ključ s drugim payloadom je conflict, a isti payload u toku je in-progress', async () => {
    const { service } = setup();
    await service.reserve(USER_ADMIN, KEY, { plate: 'A01-A-001' });

    await expect(service.reserve(USER_ADMIN, KEY, { plate: 'A01-A-002' })).resolves.toMatchObject({
      action: 'conflict',
    });
    await expect(service.reserve(USER_ADMIN, KEY, { plate: 'A01-A-001' })).resolves.toMatchObject({
      action: 'in-progress',
    });
  });

  it('samo vlasnik rezervacije smije završiti ili osloboditi ključ', async () => {
    const { redis, service } = setup();
    const decision = await service.reserve(USER_ADMIN, KEY, { plate: 'A01-A-001' });

    await expect(
      service.complete(USER_ADMIN, KEY, 'tudi-token', decision.requestHash, 201, { id: 'x' }),
    ).resolves.toBe(false);
    await expect(service.release(USER_ADMIN, KEY, 'tudi-token')).resolves.toBe(false);
    expect(onlyRecord(redis).state).toBe('in-progress');

    await expect(service.release(USER_ADMIN, KEY, decision.reservationToken!)).resolves.toBe(true);
    expect(redis.keys()).toEqual([]);
    await expect(service.reserve(USER_ADMIN, KEY, { plate: 'A01-A-001' })).resolves.toMatchObject({
      action: 'execute',
    });
  });

  it('oštećen Redis zapis se prepisuje novom rezervacijom', async () => {
    const { redis, service } = setup();
    redis.store.set(`vfm:idem:${USER_ADMIN}:${KEY}`, '{nije-json');

    await expect(service.reserve(USER_ADMIN, KEY, { plate: 'A01-A-001' })).resolves.toMatchObject({
      action: 'execute',
    });
    expect(onlyRecord(redis).state).toBe('in-progress');
  });

  it('sirova Redis greška pri rezervaciji se mapira u 503, ne u 500', async () => {
    const { redis, service } = setup();
    redis.failNext = true;

    await expect(service.reserve(USER_ADMIN, KEY, {})).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      httpStatus: 503,
    });
  });

  it('bez Redis-a eksplicitni idempotency zahtjev dobija 503', async () => {
    const service = new IdempotencyService(fakeRedisService(undefined));

    await expect(service.reserve(USER_ADMIN, KEY, {})).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      httpStatus: 503,
    });
  });
});

describe('IdempotencyInterceptor — replay', () => {
  it('prvi poziv izvrši handler, drugi isti vraća sačuvani status i tijelo bez novog poziva', async () => {
    const { interceptor } = setup();
    const counter: Counter = { calls: 0 };
    const next = countingHandler(counter, (call) => ({ id: `vozilo-${call}` }));

    const first = contextFor(requestFor({ body: { year: 2024, plate: 'A01-A-001' } }));
    await expect(invoke(interceptor, first.context, next)).resolves.toEqual({ id: 'vozilo-1' });

    const second = contextFor(requestFor({ body: { plate: 'A01-A-001', year: 2024 } }));
    await expect(invoke(interceptor, second.context, next)).resolves.toEqual({ id: 'vozilo-1' });
    expect(counter.calls).toBe(1);
    // Dummy ruta je POST s eksplicitnim @HttpCode(200): metadata ima prednost
    // nad Nest podrazumijevanim 201 za POST.
    expect(second.response.statusCode).toBe(200);
  });

  it('DELETE 204 replay ne poziva handler drugi put', async () => {
    const { interceptor } = setup();
    const counter: Counter = { calls: 0 };
    const next = countingHandler(counter, () => undefined);
    const request = () =>
      requestFor({ method: 'DELETE', url: '/api/v1/vehicles/vehicle-1', body: undefined });

    const first = contextFor(request(), new FakeResponse(), 'remove');
    await expect(invoke(interceptor, first.context, next)).resolves.toBeUndefined();

    const second = contextFor(request(), new FakeResponse(), 'remove');
    await expect(invoke(interceptor, second.context, next)).resolves.toBeNull();
    expect(counter.calls).toBe(1);
    expect(second.response.statusCode).toBe(204);
  });

  it('isti ključ s drugim tijelom ili drugom putanjom vraća 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const { interceptor } = setup();
    const counter: Counter = { calls: 0 };
    const next = countingHandler(counter, () => ({ id: 'vozilo-1' }));

    await invoke(interceptor, contextFor(requestFor()).context, next);

    await expect(
      invoke(interceptor, contextFor(requestFor({ body: { plate: 'A01-A-002', year: 2024 } })).context, next),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', httpStatus: 422 });

    await expect(
      invoke(interceptor, contextFor(requestFor({ url: '/api/v1/drivers' })).context, next),
    ).rejects.toBeInstanceOf(VfmException);
    expect(counter.calls).toBe(1);
  });

  it('ključ je u opsegu korisnika: drugi korisnik isti ključ izvršava zasebno', async () => {
    const { interceptor } = setup();
    const counter: Counter = { calls: 0 };
    const next = countingHandler(counter, (call) => ({ id: `rezultat-${call}` }));

    await expect(invoke(interceptor, contextFor(requestFor()).context, next)).resolves.toEqual({
      id: 'rezultat-1',
    });
    await expect(
      invoke(
        interceptor,
        contextFor(requestFor({ user: authenticatedUser({ id: USER_DRIVER }) })).context,
        next,
      ),
    ).resolves.toEqual({ id: 'rezultat-2' });
    expect(counter.calls).toBe(2);
  });

  it('paralelni isti zahtjev u toku dobija 409 s retry metapodacima i ne izvršava handler', async () => {
    const { interceptor, service } = setup();
    const body = { plate: 'A01-A-001', year: 2024 };
    await service.reserve(USER_ADMIN, KEY, { method: 'POST', target: '/api/v1/vehicles', body });
    const counter: Counter = { calls: 0 };

    await expect(
      invoke(
        interceptor,
        contextFor(requestFor({ body })).context,
        countingHandler(counter, () => ({ id: 'ne-smije' })),
      ),
    ).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      httpStatus: 409,
      extra: { retryAfterSeconds: 1, idempotencyState: 'in-progress' },
    });
    expect(counter.calls).toBe(0);
  });

  it('greška handlera oslobađa rezervaciju pa ispravljeni retry može proći', async () => {
    const { interceptor, redis } = setup();
    const failing = {
      handle: () => throwError(() => VfmErrors.validationError([{ path: ['plate'], message: 'neispravno' }])),
    } as CallHandler;

    await expect(invoke(interceptor, contextFor(requestFor()).context, failing)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(redis.keys()).toEqual([]);

    const counter: Counter = { calls: 0 };
    await expect(
      invoke(
        interceptor,
        contextFor(requestFor()).context,
        countingHandler(counter, () => ({ id: 'ok' })),
      ),
    ).resolves.toEqual({ id: 'ok' });
    expect(counter.calls).toBe(1);
  });
});

describe('IdempotencyInterceptor — opseg i sigurnost', () => {
  it('bez zaglavlja i za GET ne dira Redis', async () => {
    const { interceptor, redis } = setup();
    const counter: Counter = { calls: 0 };
    const next = countingHandler(counter, () => ({ ok: true }));

    await invoke(interceptor, contextFor(requestFor({ key: null })).context, next);
    await invoke(interceptor, contextFor(requestFor({ method: 'GET' })).context, next);

    expect(counter.calls).toBe(2);
    expect(redis.keys()).toEqual([]);
  });

  it('javna ruta, auth ruta i multipart prolaze bez replaya', async () => {
    const { interceptor, redis } = setup();
    const counter: Counter = { calls: 0 };
    const next = countingHandler(counter, (call) => ({ call }));

    await invoke(interceptor, contextFor(requestFor({ user: null })).context, next);
    await invoke(
      interceptor,
      contextFor(requestFor({ url: '/api/v1/auth/change-password', key: KEY_2 })).context,
      next,
    );
    await invoke(
      interceptor,
      contextFor(
        requestFor({
          url: '/api/v1/attachments',
          headers: { 'content-type': 'multipart/form-data; boundary=test' },
        }),
      ).context,
      next,
    );

    expect(counter.calls).toBe(3);
    expect(redis.keys()).toEqual([]);
  });

  it('neispravno zaglavlje vraća VALIDATION_ERROR prije handlera', async () => {
    const { interceptor } = setup();
    const counter: Counter = { calls: 0 };
    const next = countingHandler(counter, () => ({ ok: true }));

    await expect(
      invoke(interceptor, contextFor(requestFor({ key: 'ključ s razmakom' })).context, next),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', httpStatus: 400 });
    await expect(
      invoke(interceptor, contextFor(requestFor({ key: [KEY, KEY_2] })).context, next),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(counter.calls).toBe(0);
  });

  it('odgovor s privremenom lozinkom se ne kešira u Redis', async () => {
    const { interceptor, redis } = setup();
    const counter: Counter = { calls: 0 };
    const next = countingHandler(counter, (call) => ({ id: `user-${call}`, temporaryPassword: 'tajna' }));

    await expect(
      invoke(interceptor, contextFor(requestFor({ url: '/api/v1/users' })).context, next),
    ).resolves.toMatchObject({ id: 'user-1' });
    expect(redis.keys()).toEqual([]);

    await expect(
      invoke(interceptor, contextFor(requestFor({ url: '/api/v1/users' })).context, next),
    ).resolves.toMatchObject({ id: 'user-2' });
    expect(counter.calls).toBe(2);
  });

  it('osjetljiva polja se prepoznaju ugniježđeno, a tokenVersion nije tajna', () => {
    expect(containsSensitiveIdempotencyField({ user: { tokenVersion: 3 } })).toBe(false);
    expect(containsSensitiveIdempotencyField({ user: { temporaryPassword: 'x' } })).toBe(true);
    expect(containsSensitiveIdempotencyField([{ signedUrl: 'https://example.invalid/x' }])).toBe(true);
  });
});
