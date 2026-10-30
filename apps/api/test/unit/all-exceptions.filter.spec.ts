import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import { VfmException } from '../../src/common/errors/vfm-error.js';

afterEach(() => vi.restoreAllMocks());

describe('AllExceptionsFilter — request ID log visibility', () => {
  it('logs client errors at the default production INFO level with their request ID', () => {
    const info = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const request = {
      id: 'e27a45d1be0bf2812d48789eba35625d',
      method: 'GET',
      originalUrl: '/api/v1/form-schemas/active?subject=VEHICLE',
    };
    const response = {
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as never;

    new AllExceptionsFilter().catch(new VfmException('NOT_FOUND'), host);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'Klijentska greška',
        requestId: request.id,
        path: '/api/v1/form-schemas/active',
        status: 404,
      }),
      'ExceptionFilter',
    );
    expect(debug).not.toHaveBeenCalled();
  });
});
