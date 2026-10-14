import { z } from "zod";

export class ProviderFailure extends Error {
  constructor(
    public readonly status: number,
    public readonly uncertain = false,
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
    throw new ProviderFailure(response.status, response.status >= 500);
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
