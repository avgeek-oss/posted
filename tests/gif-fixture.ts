import sharp from "sharp";

export async function gifFixture(frames = 4, delay = 200) {
  const width = 160;
  const height = 90;
  const pixels = Buffer.alloc(width * height * frames * 3);
  for (let frame = 0; frame < frames; frame++) {
    for (let pixel = 0; pixel < width * height; pixel++) {
      const offset = (frame * width * height + pixel) * 3;
      pixels[offset + (frame % 3)] = 255;
    }
  }
  const image = await sharp(pixels, {
    raw: { width, height: height * frames, channels: 3, pageHeight: height },
  })
    .gif({
      delay: Array.from({ length: frames }, () => delay),
      loop: 0,
      keepDuplicateFrames: true,
    })
    .toBuffer();
  const comment = Buffer.from("private-gif-fixture");
  return Buffer.concat([
    image.subarray(0, -1),
    Buffer.from([0x21, 0xfe, comment.length]),
    comment,
    Buffer.from([0, 0x3b]),
  ]);
}
