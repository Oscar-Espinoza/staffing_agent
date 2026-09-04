import {
  DEFAULT_RETRY_AFTER_MS,
  MAX_GET_ATTEMPTS,
  MAX_RETRY_AFTER_MS,
  RETRY_BASE_DELAY_MS,
} from './config.ts';

export type GetJsonOptions = {
  baseUrl: string;
  degraded: string[];
  fetcher?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
};

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryAfterMilliseconds(value: string | null): number {
  if (value === null || value.trim() === '') return DEFAULT_RETRY_AFTER_MS;

  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.min(seconds * 1_000, MAX_RETRY_AFTER_MS)
    : DEFAULT_RETRY_AFTER_MS;
}

function unavailable(path: string, status: number | 'network error', degraded: string[]): Error {
  if (!degraded.includes(path)) degraded.push(path);
  return new Error(`${path} unavailable (last status ${status})`);
}

export async function getJson<T>(path: string, options: GetJsonOptions): Promise<T> {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const url = new URL(path, options.baseUrl);
  let lastStatus: number | 'network error' = 'network error';

  for (let attempt = 0; attempt < MAX_GET_ATTEMPTS; attempt++) {
    let response: Response | undefined;
    try {
      response = await fetcher(url);
    } catch {
      // Keep the last HTTP status: a later transport failure does not erase it.
    }

    if (response !== undefined) {
      if (response.ok) return await response.json() as T;

      lastStatus = response.status;
      if (response.status < 500 && response.status !== 429) {
        throw new Error(`${path} unavailable (last status ${response.status})`);
      }
    }

    if (attempt === MAX_GET_ATTEMPTS - 1) {
      throw unavailable(path, lastStatus, options.degraded);
    }

    const delay = response?.status === 429
      ? retryAfterMilliseconds(response.headers.get('Retry-After'))
      : RETRY_BASE_DELAY_MS * 2 ** attempt;
    await sleep(delay);
  }

  throw unavailable(path, lastStatus, options.degraded);
}
