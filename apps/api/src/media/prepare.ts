import sharp from "sharp";
import { capabilities } from "../social/capabilities.js";
import type { Provider } from "../../../../packages/contracts/src/index.js";

export async function prepareImage(original: Uint8Array, provider: Provider) {
  const limits = capabilities[provider];
  const input = sharp(original, {
    limitInputPixels: 40_000_000,
    animated: false,
  });
  const metadata = await input.metadata();
  if ((metadata.pages ?? 1) > 1)
    throw new Error(
      "Animated media must use GIF preparation to preserve its frames",
    );
  if (
    !metadata.width ||
    !metadata.height ||
    !["jpeg", "png", "webp", "gif", "heif"].includes(metadata.format ?? "")
  )
    throw new Error("Upload a supported image with valid dimensions");
  const rotatedWidth =
    (metadata.orientation ?? 1) >= 5 ? metadata.height : metadata.width;
  const rotatedHeight =
    (metadata.orientation ?? 1) >= 5 ? metadata.width : metadata.height;
  const ratio = rotatedWidth / rotatedHeight;
  // Centre-crop only images outside supported aspect ratios, preserving ordinary compositions.
  const maxRatio = provider === "threads" ? 10 : 20;
  const minRatio = provider === "threads" ? 0.01 : 0.05;
  const extract =
    ratio > maxRatio
      ? { width: Math.floor(rotatedHeight * maxRatio), height: rotatedHeight }
      : ratio < minRatio
        ? { width: rotatedWidth, height: Math.floor(rotatedWidth / minRatio) }
        : null;
  let dimension = limits.maxImageDimension;
  for (let attempt = 0; attempt < 8; attempt++) {
    let image = sharp(original, {
      limitInputPixels: 40_000_000,
      animated: false,
    }).rotate();
    if (extract)
      image = image.extract({
        ...extract,
        left: Math.floor((rotatedWidth - extract.width) / 2),
        top: Math.floor((rotatedHeight - extract.height) / 2),
      });
    const { data, info } = await image
      .resize({
        width: dimension,
        height: dimension,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: Math.max(55, 90 - attempt * 5), mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    if (data.length <= limits.maxImageBytes)
      return {
        bytes: data,
        contentType: "image/jpeg" as const,
        width: info.width,
        height: info.height,
      };
    dimension = Math.floor(dimension * 0.8);
  }
  throw new Error(
    `This image could not be reduced to ${limits.name}'s upload limit`,
  );
}
