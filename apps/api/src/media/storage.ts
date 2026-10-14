import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

export function storageConfigured() {
  return Boolean(config().POSTED_S3_ENDPOINT);
}
async function withStorage<T>(
  action: (storage: { client: S3Client; bucket: string }) => Promise<T>,
): Promise<T> {
  const value = config();
  if (!value.POSTED_S3_ENDPOINT)
    throw new Error("Media storage is not configured");
  const client = new S3Client({
    endpoint: value.POSTED_S3_ENDPOINT,
    region: value.POSTED_S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: value.POSTED_S3_ACCESS_KEY_ID,
      secretAccessKey: value.POSTED_S3_SECRET_ACCESS_KEY,
    },
  });
  try {
    return await action({ client, bucket: value.POSTED_S3_BUCKET });
  } finally {
    client.destroy();
  }
}
export async function uploadUrl(
  key: string,
  contentType: string,
  size: number,
) {
  return withStorage(({ client, bucket }) =>
    getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: size,
      }),
      { expiresIn: 900 },
    ),
  );
}
export async function mediaBytes(key: string, maxBytes = 20 * 1024 * 1024) {
  return withStorage(async ({ client, bucket }) => {
    const result = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!result.Body || (result.ContentLength ?? 0) > maxBytes)
      throw new Error("This media exceeds the upload limit");
    let length = 0;
    const chunks: Uint8Array[] = [];
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
      length += chunk.length;
      if (length > maxBytes) {
        if (
          "destroy" in result.Body &&
          typeof result.Body.destroy === "function"
        )
          result.Body.destroy();
        throw new Error("This media exceeds the upload limit");
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  });
}
export async function mediaUrl(key: string, downloadName?: string) {
  return withStorage(({ client, bucket }) =>
    getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ...(downloadName
          ? {
              ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
            }
          : {}),
      }),
      { expiresIn: 900 },
    ),
  );
}
export async function storeOriginal(
  key: string,
  bytes: Uint8Array,
  contentType: string,
) {
  await withStorage(async ({ client, bucket }) => {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        CacheControl: "private, max-age=0",
        IfNoneMatch: "*",
      }),
    );
  });
}
export async function preparedMediaUrl(
  key: string,
  bytes: Uint8Array,
  contentType = "image/jpeg",
) {
  return withStorage(async ({ client, bucket }) => {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        CacheControl: "private, max-age=0",
      }),
    );
    return getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: 3600 },
    );
  });
}
