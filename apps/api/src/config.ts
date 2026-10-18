import { z } from "zod";
const smtpFromSchema = z
  .string()
  .trim()
  .max(512)
  .refine((value) => {
    if (!value) return true;
    if (/\p{Cc}/u.test(value)) return false;
    const mailbox = value.match(/^[^<>]+<([^<>]+)>$/)?.[1] ?? value;
    return z.email().max(320).safeParse(mailbox.trim()).success;
  }, "Use an email address or a display name followed by <email address>");
const schema = z
  .object({
    DATABASE_URL: z
      .string()
      .url()
      .refine(
        (v) => ["postgres:", "postgresql:"].includes(new URL(v).protocol),
        "DATABASE_URL must use PostgreSQL",
      ),
    POSTED_WEB_URL: z
      .string()
      .url()
      .refine((v) => {
        const u = new URL(v);
        return (
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash &&
          u.pathname === "/" &&
          (u.protocol === "https:" ||
            (u.protocol === "http:" &&
              ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
        );
      }, "Use an HTTPS origin or a loopback HTTP development origin"),
    POSTED_API_URL: z
      .string()
      .url()
      .refine((v) => {
        const u = new URL(v);
        return (
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash &&
          u.pathname === "/" &&
          (u.protocol === "https:" ||
            (u.protocol === "http:" &&
              ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
        );
      }, "Use an HTTPS origin or a loopback HTTP development origin"),
    POSTED_SECRET: z.string().min(32),
    POSTED_X_CLIENT_ID: z.string().trim().default(""),
    POSTED_X_CLIENT_SECRET: z.string().default(""),
    POSTED_LINKEDIN_CLIENT_ID: z.string().trim().default(""),
    POSTED_LINKEDIN_CLIENT_SECRET: z.string().default(""),
    POSTED_LINKEDIN_PAGES_CLIENT_ID: z.string().trim().default(""),
    POSTED_LINKEDIN_PAGES_CLIENT_SECRET: z.string().default(""),
    POSTED_THREADS_CLIENT_ID: z.string().trim().default(""),
    POSTED_THREADS_CLIENT_SECRET: z.string().default(""),
    POSTED_BLUESKY_CLIENT_ID: z.string().trim().default(""),
    POSTED_BLUESKY_PRIVATE_KEY_JWK: z.string().default(""),
    POSTED_PASSWORD_VERIFY_CONCURRENCY: z.coerce
      .number()
      .int()
      .min(1)
      .max(8)
      .default(2),
    POSTED_PASSWORD_VERIFY_QUEUE_LIMIT: z.coerce
      .number()
      .int()
      .min(0)
      .max(100)
      .default(16),
    POSTED_SMTP_HOST: z.string().trim().max(253).default(""),
    POSTED_SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    POSTED_SMTP_SECURE: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    POSTED_SMTP_USER: z.string().max(320).default(""),
    POSTED_SMTP_PASSWORD: z.string().max(4096).default(""),
    POSTED_SMTP_FROM: smtpFromSchema.default(""),
    POSTED_S3_ENDPOINT: z
      .string()
      .trim()
      .default("")
      .refine((value) => {
        if (!value) return true;
        try {
          const url = new URL(value);
          return (
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash &&
            url.pathname === "/" &&
            (url.protocol === "https:" ||
              (url.protocol === "http:" &&
                ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
          );
        } catch {
          return false;
        }
      }, "Use an HTTPS storage origin or loopback HTTP for development"),
    POSTED_S3_REGION: z
      .string()
      .regex(/^[a-z0-9-]{1,80}$/)
      .default("auto"),
    POSTED_S3_BUCKET: z
      .string()
      .trim()
      .default("")
      .refine(
        (value) => !value || /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value),
        "Use a valid bucket name",
      ),
    POSTED_S3_ACCESS_KEY_ID: z.string().max(256).default(""),
    POSTED_S3_SECRET_ACCESS_KEY: z.string().max(4096).default(""),
    PORT: z.coerce.number().int().min(1).max(65535).default(4341),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  })
  .superRefine((value, ctx) => {
    for (const [id, secret] of [
      [value.POSTED_X_CLIENT_ID, value.POSTED_X_CLIENT_SECRET],
      [value.POSTED_LINKEDIN_CLIENT_ID, value.POSTED_LINKEDIN_CLIENT_SECRET],
      [
        value.POSTED_LINKEDIN_PAGES_CLIENT_ID,
        value.POSTED_LINKEDIN_PAGES_CLIENT_SECRET,
      ],
      [value.POSTED_THREADS_CLIENT_ID, value.POSTED_THREADS_CLIENT_SECRET],
      [value.POSTED_BLUESKY_CLIENT_ID, value.POSTED_BLUESKY_PRIVATE_KEY_JWK],
    ]) {
      if (Boolean(id) !== Boolean(secret))
        ctx.addIssue({
          code: "custom",
          message:
            "Configure each social provider's client ID and secret together",
        });
    }
    if (
      value.POSTED_BLUESKY_CLIENT_ID &&
      value.POSTED_BLUESKY_CLIENT_ID !==
        `${value.POSTED_API_URL.replace(/\/$/, "")}/social/bluesky/client-metadata.json`
    )
      ctx.addIssue({
        code: "custom",
        path: ["POSTED_BLUESKY_CLIENT_ID"],
        message:
          "The Bluesky client ID must be this API's /social/bluesky/client-metadata.json URL",
      });
    if (value.POSTED_BLUESKY_PRIVATE_KEY_JWK) {
      try {
        const key: unknown = JSON.parse(value.POSTED_BLUESKY_PRIVATE_KEY_JWK);
        if (
          !z
            .object({
              kty: z.literal("EC"),
              crv: z.literal("P-256"),
              d: z.string().min(1),
              x: z.string().min(1),
              y: z.string().min(1),
            })
            .safeParse(key).success
        )
          throw new Error("invalid");
      } catch {
        ctx.addIssue({
          code: "custom",
          path: ["POSTED_BLUESKY_PRIVATE_KEY_JWK"],
          message: "Use a private P-256 JWK for Bluesky client authentication",
        });
      }
    }
    const storageFields = [
      value.POSTED_S3_ENDPOINT,
      value.POSTED_S3_BUCKET,
      value.POSTED_S3_ACCESS_KEY_ID,
      value.POSTED_S3_SECRET_ACCESS_KEY,
    ];
    if (storageFields.some(Boolean) && !storageFields.every(Boolean))
      ctx.addIssue({
        code: "custom",
        path: ["POSTED_S3_ENDPOINT"],
        message:
          "Configure the S3 endpoint, bucket, access key and secret access key together",
      });
    if (
      new URL(value.POSTED_WEB_URL).origin ===
      new URL(value.POSTED_API_URL).origin
    )
      ctx.addIssue({
        code: "custom",
        path: ["POSTED_API_URL"],
        message: "UI and API require separate origins",
      });
    if (Boolean(value.POSTED_SMTP_HOST) !== Boolean(value.POSTED_SMTP_FROM))
      ctx.addIssue({
        code: "custom",
        path: ["POSTED_SMTP_HOST"],
        message: "Configure SMTP host and from address together",
      });
    if (Boolean(value.POSTED_SMTP_USER) !== Boolean(value.POSTED_SMTP_PASSWORD))
      ctx.addIssue({
        code: "custom",
        path: ["POSTED_SMTP_USER"],
        message: "Configure SMTP user and password together",
      });
    if (
      !value.POSTED_SMTP_HOST &&
      (value.POSTED_SMTP_USER || value.POSTED_SMTP_PASSWORD)
    )
      ctx.addIssue({
        code: "custom",
        path: ["POSTED_SMTP_HOST"],
        message: "SMTP credentials require a configured host",
      });
  });
export function config() {
  return schema.parse(process.env);
}
export function validateConfiguration() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("\n"),
    );
  return parsed.data;
}
