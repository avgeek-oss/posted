# Compose a post

Write a post once, choose the accounts you want to publish to, then adjust the text or media for each account if needed. You can save your work as a draft, publish it now or schedule it for later.

## Connect accounts

A team administrator opens **Connections → Add connection**, chooses a configured provider and completes its sign-in and consent flow. The account belongs to the team. Connecting the same account again refreshes its connection. Members can compose for connected accounts; administrators can add or disconnect them.

If a provider is missing, check its [configuration](/configuration#social-providers). To reconnect an account, repeat its authorization flow. Disconnecting an account prevents future publishing through it and does not remove existing posts.

## Write your post

1. Choose **Create post** from **Pending Drafts**.
2. Write your post and use **Add media** to attach images or a video.
3. Open **Choose Accounts**, select your accounts and confirm.

This is your **master post**, shared by all the accounts you choose. You can adjust each account's version next.

You can search for an account by name or handle. Your selection only takes effect when you confirm it; closing the chooser leaves your current accounts unchanged.

<!-- screenshot:composer -->

## Add media

An operator configures an [S3 source](/configuration#s3-source). Uploads use short-lived signed URLs. Original objects remain private and separate from temporary upload objects.

| Input                 | Upload limit                                                                        | Processing                                                                               |
| --------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Still JPEG, PNG, WebP | 20 MiB; 40 million decoded pixels                                                   | Orientation, metadata removal, provider-specific dimensions and compression at delivery. |
| Animated GIF          | 20 MiB; up to 250 frames, 40 million decoded pixels across all frames and 3 minutes | Asynchronous animation preparation, metadata removal and a still thumbnail.              |
| MP4 or MOV            | 100 MiB; 3 to 1800 seconds                                                          | Asynchronous normalization to H.264/AAC MP4, up to 1280×720, with metadata removed.      |

GIF and video processing require the worker. The editor waits for preparation to finish before media can be scheduled. A malformed or unsupported file fails preparation rather than appearing as a ready asset.

### GIFs

Attach one GIF on its own, without other images or videos in the same post. X and LinkedIn receive an animated GIF, prepared to fit within 1280 × 1080 pixels and 5 MB. Bluesky and Threads receive an MP4 containing the animation. Short animations repeat to meet the video minimum; single-frame GIFs become still images.

The editor and account preview use a still thumbnail to keep drafts responsive. Click the GIF thumbnail in the master or account editor to watch the animation in the media dialog. Closing the dialog stops it. Original uploads, prepared animations and thumbnails remain private.

These are conservative Posted limits. See [X’s media requirements](https://docs.x.com/x-api/media/quickstart/best-practices) and [LinkedIn’s Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-09) for their native GIF support. Uploaded GIFs use video delivery on Bluesky and Threads; Threads’ separate Tenor/GIPHY attachment feature is not a file-upload path.

### Provider limits

Reorder media to choose the most important files first. Posted uses the supported prefix for each provider.

| Provider | Text limit used by Posted             | Images               | Video duration used by Posted                      |
| -------- | ------------------------------------- | -------------------- | -------------------------------------------------- |
| X        | 280; provider-aware weighted counting | First 4              | First video; 3–140 seconds                         |
| LinkedIn | 3000                                  | First 20             | First video; 3–1800 seconds                        |
| Bluesky  | 300 grapheme clusters                 | First 4              | First video; 3–180 seconds                         |
| Threads  | 500                                   | First 20 media items | 3–300 seconds per video; mixed carousels supported |

X, LinkedIn and Bluesky accept images or a video in this version; mixing both produces an account error. Threads can use mixed media. These are conservative application limits. Provider access, quota and current policy still apply.

Add an accessible media description before uploading. Click a thumbnail in the expanded master or account editor to open a larger image or video dialog. Its title shows dimensions and file size, plus duration in seconds for animations and videos. Video playback controls appear in the larger dialog and live preview. Close with X, Escape or a click outside; dismissing the dialog stops playback. Previews do not autoplay. Original images are preserved; delivery copies may be cropped or compressed for the target provider.

## Include a link

Paste a website link into your post. In **Preview**, Posted shows its title, description and Open Graph image when the website provides them. The first link gets the card; adding images, a GIF or a video uses your attachments instead.

Each account's preview follows its own text. If a website cannot be reached or has no preview information, your link stays in the post without a card. The final appearance can vary by provider.

## Customize an account

Each selected account starts with the text and media from your master post. For example, you could keep a short caption for one account and write a longer version for another.

1. Select an account's profile picture.
2. Open **Edit** to change its text or media.
3. Open **Preview** to review your changes.

Your changes apply only to the selected account. The other accounts keep their own versions. The character count below the text shows how much space you have for that account. If something needs fixing before you can publish, Posted shows a message beside it.

Choose **Reset to master** to use the master text and media again. Posted asks you to confirm before replacing your changes. It also asks for confirmation if you remove an account that has custom content.

<!-- screenshot:account-edit -->

## Save, publish or schedule

Choose **Save as draft** to keep working later. You can save a draft before the text, media or account selection is complete. On mobile, this button uses the save icon.

When you are ready, choose **Post in X accounts** on desktop or **Post now** on mobile. Review the accounts in the confirmation dialog, then confirm to publish. The button stays disabled until you have chosen accounts and their posts are ready.

To publish later, open the arrow beside the publish button and choose **Schedule for later**. Pick a date and time, review the accounts, then confirm. Read [Scheduled posts](/scheduling) for more about managing your schedule.

<!-- screenshot:publish-confirmation -->

## Add more posts

Use **Add Another Post** to continue with another post, or **Insert post** to add one between existing posts. You can review and customize each one for your selected accounts. Read [Compose threads](/threads) for the full walkthrough.
