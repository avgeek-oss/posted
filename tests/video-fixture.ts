import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
export async function videoFixture(
  format: "mp4" | "mov" = "mp4",
  duration = 3.2,
) {
  const directory = await mkdtemp(join(tmpdir(), "posted-video-test-"));
  try {
    const path = join(directory, `fixture.${format}`);
    await promisify(execFile)(
      "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=320x180:r=30",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000",
        "-t",
        String(duration),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-threads",
        "2",
        "-metadata",
        "comment=private-video-fixture",
        path,
      ],
      { timeout: 30_000 },
    );
    return await readFile(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
