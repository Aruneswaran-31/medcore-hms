import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { PaginationMeta } from '@medcore/types';

type Envelope = { success: true; data: unknown; message: string; meta?: PaginationMeta };

/**
 * Wraps every successful payload in the standard envelope from the PRD §08:
 * { success, data, message } and { ..., meta } for paginated lists.
 */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<Envelope> {
    return next.handle().pipe(
      map((payload) => {
        if (payload && typeof payload === 'object' && 'data' in payload && 'meta' in payload) {
          const { data, meta, message } = payload as {
            data: unknown;
            meta: PaginationMeta;
            message?: string;
          };
          return { success: true as const, data, message: message ?? 'OK', meta };
        }
        if (payload && typeof payload === 'object' && '__raw' in payload) {
          return (payload as { __raw: Envelope }).__raw;
        }
        return { success: true as const, data: payload, message: 'OK' };
      }),
    );
  }
}

/** Lets a service return an envelope directly (e.g. pagination metadata). */
export function envelope<T>(data: T, meta: PaginationMeta, message = 'OK') {
  return { __raw: { success: true, data, message, meta } };
}