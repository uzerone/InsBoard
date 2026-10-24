import { ProviderError } from "../../infrastructure/providers/image-provider.js";

const TRANSIENT_PROVIDER_RETRY_DELAYS_MS = [1500, 4000] as const;

export async function mapWithConcurrency<T, TResult>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<TResult>
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export async function callProviderWithRetry<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= TRANSIENT_PROVIDER_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      throwIfAborted(signal);
      return await operation();
    } catch (error) {
      if (isAbortError(error) || signal?.aborted || !isTransientProviderError(error)) {
        throw error;
      }

      lastError = error;
      const delayMs = TRANSIENT_PROVIDER_RETRY_DELAYS_MS[attempt];
      if (delayMs === undefined) {
        break;
      }

      await delay(delayMs, signal);
    }
  }

  throw lastError;
}

function isTransientProviderError(error: unknown): boolean {
  if (!(error instanceof ProviderError)) {
    return false;
  }

  if (error.status === 429 || error.status === 503 || error.status === 504) {
    return true;
  }

  return (
    error.status === 502 &&
    /stream disconnected|connection|timeout|temporar|upstream/iu.test(error.message)
  );
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);

  await new Promise<void>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const abort = (): void => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };

    timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function errorToMessage(error: unknown): string {
  if (error instanceof ProviderError) {
    return sanitizeGenerationErrorMessage(error.message);
  }
  if (error instanceof Error && error.message) {
    return sanitizeGenerationErrorMessage(error.message);
  }
  return "Image generation failed. Try again.";
}

export function sanitizeGenerationErrorMessage(message: string): string {
  return message
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "sk-[redacted]")
    .trim()
    .slice(0, 1200);
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
