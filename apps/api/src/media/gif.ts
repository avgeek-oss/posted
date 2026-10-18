import sharp from "sharp";
import { prepareImage } from "./prepare.js";

export async function gifMetadata(original: Uint8Array) {
  if (original.length > 20 * 1024 * 1024)
    throw new Error("GIFs must be 20 MB or smaller.");
  const info = await sharp(original, {
    animated: true,
    limitInputPixels: 40_000_000,
  }).metadata();
  const frames = info.pages ?? 1;
  const height = info.pageHeight ?? info.height;
  if (
    info.format !== "gif" ||
    !info.width ||
    !height ||
    info.width > 8192 ||
    height > 8192 ||
    frames > 250 ||
    info.width * height * frames > 40_000_000
  )
    throw new Error(
      "Use a GIF with up to 250 frames and 40 million decoded pixels.",
    );
  const delays = Array.from({ length: frames }, (_, index) => {
    const delay = info.delay?.[index] ?? 100;
    return delay > 10 ? delay : 100;
  });
  const durationSeconds = delays.reduce((sum, delay) => sum + delay, 0) / 1000;
  if (durationSeconds > 180)
    throw new Error("GIFs must be 3 minutes or shorter.");
  return {
    width: info.width,
    height,
    frames,
    delays,
    loop: info.loop ?? 0,
    durationSeconds,
  };
}

export async function normalizeGif(original: Uint8Array) {
  const info = await gifMetadata(original);
  if (info.frames === 1)
    return {
      ...(await prepareImage(original, "linkedin")),
      durationSeconds: null,
      thumbnail: null,
    };
  let scale = 1;
  for (let attempt = 0; attempt < 8; attempt++) {
    const bytes = await sharp(original, {
      animated: true,
      limitInputPixels: 40_000_000,
    })
      .resize({
        width: Math.max(1, Math.floor(1280 * scale)),
        height: Math.max(1, Math.floor(1080 * scale)),
        fit: "inside",
        withoutEnlargement: true,
      })
      .gif({
        delay: info.delays,
        loop: info.loop,
        effort: 3,
        keepDuplicateFrames: true,
      })
      .toBuffer();
    if (bytes.length <= 5_000_000) {
      const ready = await gifMetadata(bytes);
      const thumbnail = await sharp(bytes)
        .resize({
          width: 480,
          height: 480,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();
      return {
        bytes,
        contentType: "image/gif" as const,
        width: ready.width,
        height: ready.height,
        durationSeconds: ready.durationSeconds,
        thumbnail,
      };
    }
    scale *= 0.8;
  }
  throw new Error("This GIF could not be reduced to the publishing limit.");
}
