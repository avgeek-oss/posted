import { z } from "zod";
import { providerResponse, ProviderFailure, retryAfter } from "./network.js";
export const metaVersion = "v26.0";
const errorSchema = z.object({
  error: z.object({ code: z.number(), is_transient: z.boolean().optional() }),
});
export async function metaJson<T>(
  url: URL,
  token: string,
  schema: z.ZodType<T>,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const response = await providerResponse(url, { ...options, headers });
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    if (response.ok) throw new ProviderFailure(response.status, true);
  }
  const error = errorSchema.safeParse(data);
  if (!response.ok || error.success) {
    const code = error.success ? error.data.error.code : undefined;
    const status =
      code === 190 || code === 102
        ? 401
        : code === 10 || code === 200
          ? 403
          : [4, 17, 32, 613, 80001].includes(code ?? -1)
            ? 429
            : error.success && error.data.error.is_transient
              ? 503
              : response.ok
                ? 400
                : response.status;
    throw new ProviderFailure(
      status,
      response.status === 408 ||
        response.status >= 500 ||
        status === 408 ||
        status >= 500,
      retryAfter(response),
    );
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ProviderFailure(response.status, true);
  return parsed.data;
}
