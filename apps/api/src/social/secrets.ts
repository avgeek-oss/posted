import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { config } from "../config.js";

function key() {
  return createHash("sha256").update(config().POSTED_SECRET).digest();
}
export function seal(value: unknown, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(context));
  const bytes = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), bytes]
    .map((part) => part.toString("base64url"))
    .join(".");
}
export function unseal(value: string, context: string): unknown {
  const [iv, tag, bytes, extra] = value.split(".");
  if (!iv || !tag || !bytes || extra)
    throw new Error("Invalid encrypted credential");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(bytes, "base64url")),
      decipher.final(),
    ]).toString("utf8"),
  );
}
