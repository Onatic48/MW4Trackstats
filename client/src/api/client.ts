import type {
  AuthStatusResponse,
  HealthResponse,
  JobErrorCode,
  JobStatusResponse,
  RecentPlayerSummary,
  StatsLookupResponse,
} from '@mw4trackstats/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: JobErrorCode,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseErrorResponse(res: Response): Promise<ApiError> {
  try {
    const json = (await res.json()) as {
      error?: {
        code?: JobErrorCode;
        message?: string;
        retryAfterSeconds?: number;
      };
    };
    const code = json.error?.code ?? 'INTERNAL_ERROR';
    const message = json.error?.message ?? `HTTP ${res.status}`;
    return new ApiError(res.status, code, message, json.error?.retryAfterSeconds);
  } catch {
    return new ApiError(res.status, 'INTERNAL_ERROR', `HTTP ${res.status}`);
  }
}

const TRANSIENT_GATEWAY_STATUSES = new Set([502, 503, 504]);

async function fetchWithTransientRetry(
  input: string,
  init?: RequestInit,
  retries = 2,
  delayMs = 350,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(input, init);
      if (!TRANSIENT_GATEWAY_STATUSES.has(res.status) || attempt === retries) {
        return res;
      }
    } catch (err) {
      lastError = err;
      if (attempt === retries) {
        throw err;
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, delayMs * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error('Network request failed');
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetchWithTransientRetry('/api/health');
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  return (await res.json()) as HealthResponse;
}

export async function fetchAuthStatus(): Promise<AuthStatusResponse> {
  const res = await fetchWithTransientRetry('/api/auth/me', {
    credentials: 'include',
  });
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  return (await res.json()) as AuthStatusResponse;
}

export async function logoutX(): Promise<void> {
  const res = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
}

export async function fetchRecentLookups(): Promise<RecentPlayerSummary[]> {
  const res = await fetchWithTransientRetry('/api/stats/recent');
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  const body = (await res.json()) as { items: RecentPlayerSummary[] };
  return body.items;
}

export async function requestPlayerStats(
  activisionId: string,
  forceRefresh = false,
): Promise<StatsLookupResponse> {
  const res = await fetchWithTransientRetry('/api/stats', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activisionId, forceRefresh }),
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return (await res.json()) as StatsLookupResponse;
}

export async function purgePlayerStats(
  activisionId: string,
): Promise<{ deleted: boolean; activisionId: string }> {
  const res = await fetch('/api/stats/purge', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activisionId }),
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return (await res.json()) as { deleted: boolean; activisionId: string };
}

export async function fetchJobStatus(jobId: string): Promise<JobStatusResponse> {
  const res = await fetch(`/api/stats/jobs/${encodeURIComponent(jobId)}`);
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  return (await res.json()) as JobStatusResponse;
}

export function openJobStream(
  jobId: string,
  onStatus: (status: JobStatusResponse) => void,
  onFallbackToPolling: () => void,
): () => void {
  if (typeof EventSource === 'undefined') {
    onFallbackToPolling();
    return () => undefined;
  }

  const es = new EventSource(`/api/stats/jobs/${encodeURIComponent(jobId)}/stream`);
  let closed = false;
  let receivedTerminal = false;

  es.addEventListener('status', (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as JobStatusResponse;
      onStatus(payload);
      if (payload.state === 'completed' || payload.state === 'failed') {
        receivedTerminal = true;
        closed = true;
        es.close();
      }
    } catch {
      // Ignore malformed SSE event payload
    }
  });

  es.onerror = () => {
    if (closed || receivedTerminal) {
      return;
    }
    closed = true;
    es.close();
    onFallbackToPolling();
  };

  return () => {
    closed = true;
    es.close();
  };
}
