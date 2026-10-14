import { secureHeaders } from "hono/secure-headers";

const securityHeaders = (connectSrc: string[], storageOrigin?: string) =>
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: [
        "'self'",
        "data:",
        "https://www.gravatar.com",
        "https://pbs.twimg.com",
        "https://media.licdn.com",
        "https://cdn.bsky.app",
        "https://*.fbcdn.net",
        "https://*.cdninstagram.com",
        ...(storageOrigin ? [storageOrigin] : []),
      ],
      mediaSrc: ["'self'", ...(storageOrigin ? [storageOrigin] : [])],
      frameSrc: ["'none'"],
      workerSrc: ["'self'"],
      connectSrc,
      fontSrc: ["'self'", ...(storageOrigin ? ["blob:"] : [])],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      frameAncestors: ["'none'"],
    },
  });

export const httpSecurity = securityHeaders(["'self'"]);
export const webSecurity = (apiOrigin: string, storageOrigin?: string) =>
  securityHeaders(
    ["'self'", apiOrigin, ...(storageOrigin ? [storageOrigin] : [])],
    storageOrigin,
  );
