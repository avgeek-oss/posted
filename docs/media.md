# Images, GIFs and videos

An operator configures an [S3 source](/configuration#s3-source). Uploads use short-lived signed URLs. Original objects remain private and separate from temporary upload objects.

| Input                 | Upload limit                                                                        | Processing                                                                               |
| --------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Still JPEG, PNG, WebP | 20 MiB; 40 million decoded pixels                                                   | Orientation, metadata removal, provider-specific dimensions and compression at delivery. |
| Animated GIF          | 20 MiB; up to 250 frames, 40 million decoded pixels across all frames and 3 minutes | Asynchronous animation preparation, metadata removal and a still thumbnail.              |
| MP4 or MOV            | 100 MiB; 3 to 1800 seconds                                                          | Asynchronous normalization to H.264/AAC MP4, up to 1280×720, with metadata removed.      |

GIF and video processing require the worker. The editor waits for preparation to finish before media can be scheduled. A malformed or unsupported file fails preparation rather than appearing as a ready asset.

## GIFs

Attach one GIF on its own, without other images or videos in the same post. X and LinkedIn receive an animated GIF, prepared to fit within 1280 × 1080 pixels and 5 MB. Bluesky and Threads receive an MP4 containing the animation. Short animations repeat to meet the video minimum; single-frame GIFs become still images.

The editor and account preview use a still thumbnail to keep drafts responsive. Click the GIF thumbnail in the master or account editor to watch the animation in the media dialog. Closing the dialog stops it. Original uploads, prepared animations and thumbnails remain private.

These are conservative Posted limits. See [X’s media requirements](https://docs.x.com/x-api/media/quickstart/best-practices) and [LinkedIn’s Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-09) for their native GIF support. Uploaded GIFs use video delivery on Bluesky and Threads; Threads’ separate Tenor/GIPHY attachment feature is not a file-upload path.

## Customize an account

In an account's **Edit** view, add or remove media and drag the six-dot handle to reorder attachments. The vertical insertion line shows where the item will land. Dragging the image itself does not reorder it; clicking it opens the larger preview. Changes apply only to that account and post. Removing every inherited attachment keeps that account text-only. **Reset to master** restores both text and media after confirmation.

## Link previews

Posts without attachments can show a website card from the first link in the text. Posted reads the website's title, description and Open Graph image. LinkedIn and Bluesky receive an explicit card; X and Threads generate their own from the link. Websites can restrict previews, and unavailable metadata leaves the text and link intact. Link cards do not require S3 source.

## Provider selection

Reorder media to choose the most important files first. Posted uses the supported prefix for each provider.

| Provider | Text limit used by Posted             | Images               | Video duration used by Posted                      |
| -------- | ------------------------------------- | -------------------- | -------------------------------------------------- |
| X        | 280; provider-aware weighted counting | First 4              | First video; 3–140 seconds                         |
| LinkedIn | 3000                                  | First 20             | First video; 3–1800 seconds                        |
| Bluesky  | 300 grapheme clusters                 | First 4              | First video; 3–180 seconds                         |
| Threads  | 500                                   | First 20 media items | 3–300 seconds per video; mixed carousels supported |

X, LinkedIn and Bluesky accept images or a video in this version; mixing both produces an account error. Threads can use mixed media. These are conservative application limits. Provider access, quota and current policy still apply.

Add an accessible media description before uploading. Click a thumbnail in the expanded master or account editor to open a larger image or video dialog. Its title shows dimensions and file size, plus duration in seconds for animations and videos. Video playback controls appear in the larger dialog and live preview. Close with X, Escape or a click outside; dismissing the dialog stops playback. Previews do not autoplay. Original images are preserved; delivery copies may be cropped or compressed for the target provider.
