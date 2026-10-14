import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { videoUploadBytes } from "../../../../packages/contracts/src/media.js";

const execute = promisify(execFile);
const metadata = z.object({
  streams: z.array(
    z.object({
      codec_type: z.string(),
      codec_name: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    }),
  ),
  format: z.object({ duration: z.coerce.number().positive().max(1800) }),
});
async function probe(path: string) {
  const { stdout } = await execute(
    "ffprobe",
    [
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      path,
    ],
    { timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  const result = metadata.parse(JSON.parse(stdout));
  const video = result.streams.filter(
    (stream) => stream.codec_type === "video",
  );
  if (
    video.length !== 1 ||
    !video[0].width ||
    !video[0].height ||
    video[0].width > 8192 ||
    video[0].height > 8192 ||
    result.format.duration < 3
  )
    throw new Error(
      "Upload a video between 3 seconds and 30 minutes with valid dimensions.",
    );
  return {
    width: video[0].width,
    height: video[0].height,
    durationSeconds: result.format.duration,
  };
}
export async function normalizeVideo(original: Uint8Array) {
  if (original.length > videoUploadBytes)
    throw new Error("Videos must be 100 MB or smaller.");
  const directory = await mkdtemp(join(tmpdir(), "posted-video-"));
  try {
    const input = join(directory, "input");
    const output = join(directory, "video.mp4");
    await writeFile(input, original, { mode: 0o600 });
    await probe(input);
    await execute(
      "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        input,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-map_metadata",
        "-1",
        "-map_chapters",
        "-1",
        "-vf",
        "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=w=max(iw\\,ceil(ih/3/2)*2):h=max(ih\\,ceil(iw/3/2)*2):x=(ow-iw)/2:y=(oh-ih)/2",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-r",
        "30",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ac",
        "2",
        "-ar",
        "48000",
        "-movflags",
        "+faststart",
        "-fs",
        String(videoUploadBytes + 1),
        "-threads",
        "2",
        "-t",
        "1801",
        output,
      ],
      { timeout: 900_000, maxBuffer: 1024 * 1024 },
    );
    if ((await stat(output)).size > videoUploadBytes)
      throw new Error("The prepared video exceeds the 100 MB limit.");
    const info = await probe(output);
    const bytes = await readFile(output);
    if (bytes.length > videoUploadBytes)
      throw new Error("The prepared video exceeds the 100 MB limit.");
    return { ...info, bytes, contentType: "video/mp4" as const };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
