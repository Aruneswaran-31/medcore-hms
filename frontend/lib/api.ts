/**
 * Thin client for the MedCore API.
 *
 * Access tokens live in memory only; the refresh token is an httpOnly cookie
 * (path /api/auth) set by the API, so the browser holds the long-lived
 * credential and this module never touches it. On a 401 we rotate the refresh
 * cookie once and replay the original request.
 */
import type { ApiErrorBody, ApiSuccess, SessionUser } from '@medcore/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL
  ? `${process.env.NEXT_PUBLIC_API_URL}/api`
  : '/api';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

/**
 * Stable per-browser session id. The API keys refresh-token rotation on
 * (user, deviceId); without this every browser would fall back to the shared
 * `default-device` slot and sign each other out on rotation.
 */
function deviceId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const KEY = 'medcore_device';
    let id = window.localStorage.getItem(KEY);
    if (!id) {
      id =
        typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      window.localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

/** Rotates the refresh cookie and stores the new access token. At most one in flight. */
export async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: deviceId() ? { 'x-device-id': deviceId() } : {},
      });
      if (!res.ok) {
        accessToken = null;
        return false;
      }
      const body = (await res.json()) as {
        success?: boolean;
        data?: { accessToken?: string };
        error?: { code?: string };
      };
      // Missing/expired cookie comes back as HTTP 200 with an error envelope.
      const token = body?.data?.accessToken;
      if (body?.success === false || !token) {
        accessToken = null;
        return false;
      }
      accessToken = token;
      return true;
    } catch {
      accessToken = null;
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

type RequestOptions = RequestInit & { retry?: boolean };

/** Returns the `data` member of the API envelope, or throws an ApiError. */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { retry = true, headers, ...rest } = options;

  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    credentials: 'include',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(deviceId() ? { 'x-device-id': deviceId() } : {}),
      ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
      ...(headers as Record<string, string> | undefined),
    },
  });

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) return api<T>(path, { ...options, retry: false });
    accessToken = null;
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new ApiError('BAD_RESPONSE', `Request failed (${res.status})`, res.status);
  }

  if (!res.ok || (payload as { success?: boolean }).success === false) {
    const err = (payload as ApiErrorBody).error;
    throw new ApiError(
      err?.code ?? 'ERROR',
      err?.message ?? `Request failed (${res.status})`,
      res.status,
    );
  }

  return (payload as ApiSuccess<T>).data;
}

/** Session bootstrap: restores the user after a full page reload. */
export async function loadSession(): Promise<SessionUser | null> {
  const ok = await refreshSession();
  if (!ok) return null;
  try {
    return await api<SessionUser>('/auth/me');
  } catch {
    return null;
  }
}
