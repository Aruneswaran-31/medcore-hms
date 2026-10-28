import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * Single error shape for the whole API:
 * { success: false, error: { code, message, details? } }
 * Unexpected errors are logged with stack trace but never leaked to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload =
        typeof body === 'string'
          ? { code: 'ERROR', message: body }
          : ((body as Record<string, any>) ?? {});

      const code = payload.code ?? this.codeForStatus(status);
      const message = payload.message ?? exception.message;
      const details = payload.details ?? (payload.errors ?? undefined);

      return response.status(status).json({
        success: false,
        error: { code, message: Array.isArray(message) ? message.join(', ') : message, details },
      });
    }

    this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : String(exception));
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
    });
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case 400:
        return 'VALIDATION_ERROR';
      case 401:
        return 'UNAUTHENTICATED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'NOT_FOUND';
      case 409:
        return 'CONFLICT';
      case 429:
        return 'RATE_LIMITED';
      default:
        return status >= 500 ? 'INTERNAL_ERROR' : 'ERROR';
    }
  }
}