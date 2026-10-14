import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const client = new S3Client({
  endpoint: "http://127.0.0.1:55491",
  region: "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: "posted-local-fixture",
    secretAccessKey: "posted-disposable-storage-passphrase",
  },
});
const bucket = "posted-preview";
try {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    if (
      !(error instanceof S3ServiceException) ||
      error.$metadata.httpStatusCode !== 404
    )
      throw error;
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: ["http://localhost:4342"],
            AllowedMethods: ["GET", "PUT"],
            AllowedHeaders: ["*"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
  await mkdir("artifacts", { recursive: true });
  await sharp(
    Buffer.from(
      `<svg width="1600" height="1000" xmlns="http://www.w3.org/2000/svg"><rect width="1600" height="1000" fill="#1264b8"/><circle cx="1150" cy="360" r="260" fill="#6eb9f2"/><circle cx="1320" cy="720" r="360" fill="#29457b"/><text x="130" y="430" font-family="sans-serif" font-size="108" font-weight="600" fill="white">One idea.</text><text x="130" y="560" font-family="sans-serif" font-size="108" font-weight="600" fill="white">Every audience.</text></svg>`,
    ),
  )
    .png()
    .toFile("artifacts/posted-preview.png");
  console.log(
    "Disposable storage ready: posted-preview on loopback port 55491. Preview image: artifacts/posted-preview.png.",
  );
} finally {
  client.destroy();
}
