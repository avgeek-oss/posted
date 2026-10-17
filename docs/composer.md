# Compose a post

The editor keeps master posts on the left and an account workspace on the right. On desktop, the account workspace opens in **Preview**; switch to **Edit** to customize an account’s content. On mobile, use **Write** and **Accounts**. The Accounts tab contains the same **Edit** and **Preview** views as desktop. Publishing controls stay at the top.

## Shared and account-specific text

Write the master text, then open **Choose Accounts**. Search accounts and select them using the row or checkbox. These changes stay pending inside the chooser until **Choose X accounts**. Closing the chooser discards the pending selection. If choosing the accounts would remove an account with custom content on any post, a confirmation lists the affected accounts before applying the selection and discarding their custom content across the sequence. Cancel preserves the current accounts and edits. Selected accounts appear as avatars with their provider logo. The avatar strip scrolls horizontally when it cannot fit every account.

Click an avatar to view that account, then choose **Edit** to customize its text. All of the account's posts stay expanded. Each account post also shows its media. Add files, remove attachments or drag their six-dot handles to change the order for that account only. A vertical insertion line shows the drop location between attachments; dragging an image body does not reorder it. Text and media inherit the master until customized; an empty custom media selection keeps the account text-only. Choose the inline **Reset to master** link and confirm in the dialog to restore both master text and media. Cancel preserves custom content. The character counter uses the selected provider's limit. Previews stop at that limit; the original text remains available for editing. An error badge identifies an account that cannot currently publish.

## Media and previews

Choose **Add media** to upload supported [images or videos](/media). Reorder uploaded files using their drag handle or keyboard controls. The first files in that order take priority when a provider accepts fewer files. Preview images stay compact; a single image preserves its proportions rather than filling the card width. Video previews have native playback controls and do not autoplay.

Click an image or video thumbnail in the expanded master or account editor to open a larger preview. The title includes chips for dimensions and file size, plus duration for videos. Images fit inside the dialog without cropping, and videos have playback controls. Close it with the X button, Escape or a click outside the dialog. Closing a video preview stops its playback.

Empty previews show an italic “Your post will appear here.” placeholder with a red alert triangle. Hover or focus the icon to see “Post copy missing, type in the composer to reflect in the preview.” The hint also opens when pressed on touch devices. Previews show content and supported media, but they do not replace provider validation. Providers may reject a request because of account access, quota or policy.

## Multiple posts and threads

Choose **Add Another Post** below the last card to append another numbered post. Each post has its own master text, media and account-specific text. The active post stays expanded; other posts show their full text, wrapping within the card and preserving line breaks, along with media thumbnails. Use the separate chevron icon button to expand or collapse a master post; the title and summary have no button hover treatment. Add as many posts as you need, or remove a post using its remove button and confirming the dialog. Removal discards that post’s master text, media and account overrides; Cancel keeps them. Insert between existing posts using the always-visible inline insert control or the post actions menu. Drag a post by its handle, use the keyboard drag controls, or choose **Move up** / **Move down** from its actions menu to reorder the complete post, including media and account overrides. Media order and provider limits apply separately to each post.

Selecting an account shows its numbered posts in **Edit** and the full sequence in **Preview**. All account posts remain expanded for editing, independently of the master outline. Editing or previewing an account does not open its master posts. X, Bluesky and Threads publish the sequence as linked replies, with short inset connectors between preview cards and reply labels beside them. LinkedIn publishes numbered individual posts in the same order, with a larger gap between their preview cards. The account heading shows only the provider and handle. Editing an account's text or ordered media changes only that post for that account; **Reset to master** restores both text and media inheritance for it after confirmation.

Saving a draft, scheduling, editing or cancelling applies to the whole sequence. Delivery details show each post's result separately. A later post waits for the previous post on that account to finish successfully. If an earlier post fails or its result is uncertain, subsequent posts on that account are not sent. Confirmed publications remain visible, and replaying the original request does not publish them again.

On mobile, switch between **Write** and **Accounts**. Inside **Accounts**, use **Preview** to review the selected account or **Edit** to customize it, just as on desktop. Mobile attachment thumbnails are wider, with filenames truncated to one line. Tab content aligns with its surrounding content without an extra horizontal inset.

## Media performance

Images load lazily with asynchronous decoding. Video sources load as they approach the viewport; playback pauses when a video leaves the nearby viewport or the browser tab becomes hidden. Inactive account panels are unmounted. Preview URLs are cached per media item and refreshed before expiry, with at most four requests in flight. Editing text keeps unchanged media grids intact.

## Publishing controls

**Save as draft** accepts incomplete content and provider errors. **Post in X accounts** shows the selected account count and opens a confirmation modal. Before selecting an account, the disabled action reads **Post now**. Both publishing and scheduling dialogs list each destination account and whether it receives a thread or individual posts. **Schedule for later** opens a date and time modal, with a compact time field below the calendar. Publishing controls remain disabled until every post for every selected account is valid and uploads are ready.

When editing a scheduled post, **Save changes** preserves the current time; **Save & Update Schedule** changes it. A stale edit conflicts rather than overwriting another person's work. Leaving with unsaved edits opens a confirmation dialog.
