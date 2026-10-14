# Images and videos

An operator enables [private S3-compatible storage](/storage). Uploads use short-lived signed URLs. Original objects remain private and separate from temporary upload objects.

| Input                 | Upload limit                      | Processing                                                                               |
| --------------------- | --------------------------------- | ---------------------------------------------------------------------------------------- |
| Still JPEG, PNG, WebP | 20 MiB; 40 million decoded pixels | Orientation, metadata removal, provider-specific dimensions and compression at delivery. |
| MP4 or MOV            | 100 MiB; 3 to 1800 seconds        | Asynchronous normalization to H.264/AAC MP4, up to 1280×720, with metadata removed.      |

Video processing requires the worker. The editor waits for ready metadata before a video can be scheduled. A malformed or unsupported file fails preparation rather than appearing as a ready asset.

## Provider selection

Reorder media to choose the most important files first. Posted uses the supported prefix for each provider.

| Provider | Text limit used by Posted             | Images               | Video duration used by Posted                      |
| -------- | ------------------------------------- | -------------------- | -------------------------------------------------- |
| X        | 280; provider-aware weighted counting | First 4              | First video; 3–140 seconds                         |
| LinkedIn | 3000                                  | First 20             | First video; 3–1800 seconds                        |
| Bluesky  | 300 grapheme clusters                 | First 4              | First video; 3–180 seconds                         |
| Threads  | 500                                   | First 20 media items | 3–300 seconds per video; mixed carousels supported |

X, LinkedIn and Bluesky accept images or a video in this version; mixing both produces an account error. Threads can use mixed media. These are conservative application limits. Provider access, quota and current policy still apply.

Add an accessible media description before uploading. Native video controls work in the media strip and live preview. Previews do not autoplay. Original images are preserved; delivery copies may be cropped or compressed for the target provider.
