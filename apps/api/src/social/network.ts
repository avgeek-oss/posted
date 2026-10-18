import { z } from "zod";

export class ProviderFailure extends Error {
  constructor(
    public readonly status: number,
    public readonly uncertain = false,
    public readonly retryAfterMs = 0,
  ) {
    super(
      status === 401 || status === 403
        ? "Reconnect this account to renew its publishing permission"
        : status === 429
          ? "This provider's rate limit was reached. Try again later"
          : uncertain
            ? "The provider's response could not be confirmed. Check the connected account before trying again"
            : `The provider rejected this request (HTTP ${status})`,
    );
  }
}

export function temporaryFailure(error: unknown): boolean {
  if (error instanceof ProviderFailure)
    return (
      error.status === 0 ||
      error.status === 408 ||
      error.status === 429 ||
      error.status >= 500
    );
  if (!(error instanceof Error)) return false;
  if (
    ["TimeoutError", "AbortError", "RequestTimeout", "SlowDown"].includes(
      error.name,
    )
  )
    return true;
  if (
    "code" in error &&
    [
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "ENETUNREACH",
    ].includes(String(error.code))
  )
    return true;
  if (
    "$metadata" in error &&
    error.$metadata &&
    typeof error.$metadata === "object" &&
    "httpStatusCode" in error.$metadata
  ) {
    const status = error.$metadata.httpStatusCode;
    return typeof status === "number" && (status === 429 || status >= 500);
  }
  return false;
}

function retryAfter(response: Response) {
  const value = response.headers.get("Retry-After");
  const reset = response.headers.get("x-rate-limit-reset");
  const seconds = value === null || !value.trim() ? NaN : Number(value);
  const milliseconds =
    value === null
      ? 0
      : Number.isFinite(seconds)
        ? seconds * 1000
        : Date.parse(value) - Date.now();
  const resetMilliseconds =
    reset && Number.isFinite(Number(reset))
      ? Number(reset) * 1000 - Date.now()
      : 0;
  return Math.max(
    0,
    Number.isFinite(milliseconds) ? milliseconds : 0,
    response.status === 429 ? resetMilliseconds : 0,
  );
}
export async function providerRequest(
  url: string | URL,
  options: RequestInit = {},
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      redirect: "error",
      signal: options.signal ?? AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ProviderFailure(0, true);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderFailure(
      response.status,
      response.status === 408 || response.status >= 500,
      retryAfter(response),
    );
  }
  return response;
}
export async function providerJson<T>(
  url: string | URL,
  schema: z.ZodType<T>,
  options: RequestInit = {},
): Promise<T> {
  const response = await providerRequest(url, options);
  try {
    return schema.parse(await response.json());
  } catch {
    throw new ProviderFailure(response.status, true);
  }
}
export function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
export function jsonBody(value: unknown) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  };
}
