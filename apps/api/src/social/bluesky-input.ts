import { isUnicastIpHostname } from "@atproto-labs/fetch-node";
import { z } from "zod";

export const blueskyLoginSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .transform((value) => value.replace(/^@/, ""))
  .transform((value, ctx) => {
    if (/^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/.test(value))
      return value.toLowerCase();
    try {
      const url = new URL(value);
      if (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash &&
        url.hostname.includes(".") &&
        !/(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname) &&
        isUnicastIpHostname(url.hostname) !== false
      )
        return url.origin;
    } catch {
      // A non-URL value is validated as a handle above.
    }
    ctx.addIssue({
      code: "custom",
      message:
        "Enter a Bluesky handle or a public HTTPS server URL, such as https://bsky.social",
    });
    return z.NEVER;
  });
