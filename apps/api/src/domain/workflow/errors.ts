
export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Workflow run was cancelled.", "AbortError");
  }
}

export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted || (error instanceof DOMException && error.name === "AbortError"));
}

export function errorToMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Workflow image generation failed.";
}
