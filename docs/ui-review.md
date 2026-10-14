# Posted UI review

Reviewed on 13 October 2026 using the disposable Posted Preview installation, the published design-system package 1.2.17 and the reference implementations in Towbar, Mill, Rootset and Vitalog. This review checks Posted's shared compositions and rendered routes; it does not establish the current production state of those applications.

## Coverage

| Area              | Checks                                                                                                                                             | Result |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Application shell | Inter, theme tokens, logo, navigation, breadcrumbs, profile popover, mobile drawer and secondary settings navigation                               | Passed |
| Composer          | New and scheduled edit, provider limits, account selection, image preview, provider preview selection, empty preview, keyboard selection           | Passed |
| Upload            | Shared modal, image description, actual upload to disposable local S3, progress, completed image, return focus                                     | Passed |
| Draft protection  | Unsaved edit prompts before leaving; Escape keeps the draft; restoring the original text permits navigation                                        | Passed |
| Posts             | Delivery count, relative and absolute scheduled time, provider labels, status chips, delivery details, empty history, pagination outside the table | Passed |
| Account settings  | Profile, preferences, email/password, verified first-admin state, passkey empty state, sessions, personal API-key table and creation dialog        | Passed |
| Team settings     | General, members, last-admin action restrictions, invitation dialog, team API-key table                                                            | Passed |
| MCP               | Shared connections table, ChatGPT logo for Codex, MCP icons, OAuth-only client configuration, user-selected Read-only/Write/Administrator consent  | Passed |
| Unavailable API   | Built UI with an isolated unreachable API shows the shared reconnecting interstitial                                                               | Passed |

Responsive checks used 1280×900 desktop, 768×1024 tablet and 390×844 mobile viewports. Light and dark themes were reviewed. Tables contain their own horizontal scrolling, with no document overflow at the tested widths. Main icon actions have accessible names; the reviewed mobile buttons, selects and close controls have 44px minimum targets. Keyboard checks covered preview selection, Escape dismissal and restoring focus to Add connection and Add images.

## Corrections

- Aligned profile-menu labels to Auth & Security, My API Keys and Feedback.
- Preview choices include the provider and handle in their accessible label, distinguishing accounts with identical names.
- Post-table provider icons and delivery-detail account cells announce both the provider and account name.
- Add connection distinguishes loading and fetch failure from an unconfigured provider; failures use shared toast feedback and Retry.
- Applied mobile minimum control sizes to the existing shared controls without changing their desktop sizing or introducing replacement components.

## Verification and boundaries

`pnpm verify` passed formatting, lint, strict TypeScript, all 42 tests with no failures or skips, and production builds. A fresh `posted-web:ui-audit` image started as the non-root node user with a read-only filesystem and all capabilities dropped. Readiness, deep composer/MCP routes and runtime configuration returned HTTP 200 with the expected security headers. The temporary container and isolated unavailable-API UI server were removed after verification; the normal preview stayed running.

No real social post, invitation email, new API key or approved MCP grant was created. Provider OAuth and live delivery require separately configured and approved provider applications. The sample upload used disposable local storage.

Screenshots are saved locally in `artifacts/posted-audit-composer-desktop-light.png`, `artifacts/posted-audit-composer-desktop-dark.png`, `artifacts/posted-audit-composer-mobile-light.png`, `artifacts/posted-audit-connections-mobile-light.png`, `artifacts/posted-audit-consent-mobile.png`, `artifacts/posted-audit-upload-mobile.png` and `artifacts/posted-audit-offline.png`.

## Composer direction — 13 October 2026

Selected the compact composer following the Mobbin comparison, with a simpler account chooser and account-specific text. Master text appears first. Choose Accounts opens a searchable, scrollable list without network filters, selected-only mode or pagination. Chosen accounts appear as avatars with a social-provider badge at the bottom right. Selecting an avatar opens that account's editor and live preview. Account text follows the master until customised; Use master text removes the override. Images remain shared across the posting request.

Rejected the growing account-card grid and the permanent account rail: both take space away from composition as connections increase. The exploration picker and its isolated route have been removed.

Account overrides are persisted on delivery records, validated for the selected provider, restored when editing schedules, included in idempotency checks and used by queue claims. No external publishing is used for this verification.

Verification passed all 44 tests, strict TypeScript, lint, formatting and the production build. Browser checks covered desktop and 390px mobile in light/dark themes, avatar selection, search, Escape/focus restoration, master inheritance, custom text, reset focus, and saving/reopening a disposable local schedule. The built API, worker and UI were ready against a separate empty database as UID 1000, with read-only filesystems and all capabilities dropped; composer deep routes and runtime configuration returned HTTP 200. Temporary verification containers were removed. Evidence is in `artifacts/compact-composer-containers.json` and `artifacts/posted-compact-composer-*.png`.

### Composer column placement

The desktop composer now places master text and image uploads on the left. Account selection, the active account's text and its live preview share the right column. Mobile stacks these groups in that order; publishing controls and the save action span the form. Desktop/mobile light/dark review confirmed the layout, avatar switching, and upload-modal dismissal/focus restoration, with no horizontal document overflow. `pnpm verify` again passed all 44 tests, formatting, lint, strict types and the production build. Captures are in `artifacts/posted-composer-columns-desktop-light.png`, `artifacts/posted-composer-columns-desktop-dark.png` and `artifacts/posted-composer-columns-mobile-dark.png`.

The composer header and Create post action use the compose/pencil icon (`Edit02Icon`). Back to schedule has been removed from the composer header. The rendered Create post route, targeted lint, strict web types and production web build passed after this change; capture: `artifacts/posted-create-post-header.png`.

Social-provider logos now use the X, LinkedIn, Bluesky and Threads vector assets exported from the Sketch document’s Social Icons page. The shared provider presentation uses these assets in tables, choices, previews and avatar badges. Desktop dark and mobile light browser review confirmed all four badges and successful image loads; targeted lint, strict web types and the production build passed. Export instructions are in `design/README.md`, with captures in `artifacts/posted-sketch-provider-icons-desktop.png` and `artifacts/posted-sketch-provider-icons-mobile-light.png`.

The composer uses three HeroUI Cards: master content with images, account selection/editor/live preview, and publishing time. Desktop places publishing time directly below master content; mobile orders master content, accounts, then publishing time. Both secondary textareas retain associated screen-reader labels without visible labels. The master textarea starts at 12 rows and remains resizable. Account helper descriptions and the outside selected-account count are removed, while the character counter remains directly beneath the account textarea. Live preview has one heading and no duplicate provider/Preview header. Avatar buttons use 4px outer padding around 48px avatars. The checkbox control is inside Checkbox.Content so the control and account row both toggle selection. Social-provider SVGs and PNG references were refreshed from Sketch.

Desktop/mobile light/dark browser review verified checkbox clicks, account-row clicks, custom-text/reset behavior and character counts, mobile card order, the publishing calendar, 16px input text and no horizontal overflow. Formatting, targeted lint, strict web types and the production web build passed. Captures: `artifacts/posted-composer-cards-desktop-light.png`, `artifacts/posted-composer-cards-mobile-light.png` and `artifacts/posted-composer-cards-mobile-dark.png`.

The account picker now keeps avatars on the left and Choose Accounts on the right in one row. With no accounts selected, the same button translates to the left and the placeholder sits 12px below it. A 220ms CSS translate transition handles movement in both directions and is disabled for reduced motion. The avatar strip scrolls horizontally without a scrollbar; mobile review verified scrolling to the last avatar inside the card without document overflow. Account text starts at three rows (110px in the reviewed browser), and the live-preview article has no shadow. The desktop publish action is attached to the composer form from the page header; mobile renders it at the end, aligned left. The previous bottom divider and delivery count are removed. Native form ownership, empty/valid-content disabled states, formatting, lint, strict web types and production build passed. Captures: `artifacts/posted-composer-actions-desktop-light.png` and `artifacts/posted-composer-actions-mobile-light.png`.

## Image priority and account validation

The avatar strip uses the published ScrollShadow with horizontal fades and hidden scrollbars. Text limits, missing content and disconnected-account errors appear immediately as red top-left avatar badges with accessible names and explanatory tooltips. Correcting an account's content removes its badge and updates submission eligibility. Image ordering uses React Aria GridList drag-and-drop with visible grips, pointer/keyboard support and a scoped drop-target outline. The image collection is loaded only when images are present. Reordering updates the preview without fetching fresh URLs for unchanged images.

Uploaded images stay in one horizontal row using the same ScrollShadow fades and hidden scrollbar as the accounts. Desktop fits four cards and mobile fits two before scrolling. Desktop pointer reorder and mobile keyboard reorder were checked after the layout change; mobile scrolling reveals the remaining images without document overflow. The grip uses a compact transparent button. Captures are in `artifacts/posted-horizontal-images-desktop.png` and `artifacts/posted-horizontal-images-mobile.png`. Strict types, targeted lint and the production web build passed.

Live preview text stops at each provider's character limit, retaining Bluesky grapheme clusters and X's weighted URL/Unicode rules. The editor keeps the full text and immediate invalid-account state. A 301-character Bluesky override rendered 300 characters in the preview while retaining 301 in the editor and disabling Save changes. The focused regression covers all provider caps, complete emoji and weighted X links. Multi-image preview rows use a 16:9 aspect ratio.

## Publishing button group and scheduling modal

The publishing-time card and mobile footer action are replaced by one HeroUI ButtonGroup in the page header. Post now opens a confirmation in the shared Dialog before queuing the current draft; the dropdown opens Schedule in the same modal composition. The modal uses HeroUI's date/time picker, calendar and year selection, with past dates disabled and a required future value. Cancellation restores focus to the dropdown and leaves the saved schedule unchanged. Existing scheduled posts retain Save changes and use the modal to reschedule. Busy and uncertain-save states preserve the existing frozen-payload/idempotency behavior.

Desktop and 390px mobile review covered the split button, menu, light/dark modal, keyboard date/time changes, calendar year/day selection, rejection of a past date, cancellation/focus restoration, real scheduling submission and saved-time restoration. The disposable local post `1ecb8e12-5a2a-4e33-b7f1-f33ee6d2e489` was scheduled for 14 October 2027 at 13:58 in America/Grand_Turk, with a sample Bluesky connection; no delivery worker or real provider request was used. Mobile showed one header action and no horizontal document overflow. Captures are in `artifacts/posted-publish-group-mobile-dark.png`, `artifacts/posted-publish-group-mobile-light.png`, `artifacts/posted-schedule-modal-mobile-dark.png` and `artifacts/posted-schedule-modal-mobile-light.png`. The full check passed all 47 tests, formatting, lint, strict types and production builds.

The updated UI container passed readiness, new/edit deep routes and runtime configuration with CSP, running as UID 1000 with a read-only filesystem, no added capabilities and no-new-privileges. Evidence is in `artifacts/publishing-modal-container.json`; the temporary container was removed. Final desktop modal capture: `artifacts/posted-schedule-modal-desktop.png`.

Desktop pointer drag, desktop keyboard reorder, mobile pointer drag, saved edit restoration, per-account override errors/reset and the four-image Bluesky preview were verified on a disposable local post with six synthetic images. Mobile review found no horizontal document overflow. Captures: `artifacts/posted-priority-errors-desktop-light.png`, `artifacts/posted-priority-errors-mobile-light.png` and `artifacts/posted-image-priority-mobile-light.png`. All 46 PostgreSQL/storage/provider tests passed. A storage regression verifies persisted order, changed-order idempotency conflicts and the worker's exact first-four uploads using mocked X requests. API, worker and UI containers passed health, non-root, read-only and dropped-capability checks in an isolated empty database; evidence is in `artifacts/priority-containers.json`. Temporary verification containers and credential files were removed; the normal preview remains available.

The Post now confirmation was reviewed at desktop and 390px mobile widths. Opening it left the draft in the editor; Cancel retained its text/account selection and returned focus to the header action. The composer form also goes through confirmation. Pending requests disable dismissal and both actions; safe retries retain the previously confirmed payload. Captures: `artifacts/posted-post-now-confirmation-desktop.png` and `artifacts/posted-post-now-confirmation-mobile.png`. Strict types, targeted lint and the production web build passed. Verification cancelled both dialogs without sending a publishing request.

## Delivery-set details and schedule navigation

Confirmed Post now navigates to `/posts/{id}` using the returned post ID. The dedicated delivery page polls the existing read endpoint every five seconds while visible and uses the shared table/pagination on desktop and mobile. It shows each account's effective text, status, published time and result; long account names, content and errors stay within two lines with full-text tooltips. Post History's Details link opens the page, replacing the details modal. Scheduled Posts no longer shows Details. Existing schedule menu/confirmation actions read Save & Update Schedule, and editing breadcrumbs are Scheduled Posts / short ID / Edit Schedule with working ancestor links and a full-ID tooltip.

The local Post now confirmation for `Post-now confirmation review` navigated to `fe7e4804-ed9c-4874-b88f-b5da1fd7fd3d`. No worker was running, and the sole sample Bluesky delivery was cancelled immediately through the authenticated API; no provider request was made. The detail page refreshed to Cancelled and was reopened through its history link. Scheduled-list Details counts were zero. The update-schedule modal and edit breadcrumb were reviewed without modifying the existing fixture. At 390px the six-delivery table scrolled within its 350px container, with no document overflow, in light/dark themes. Captures: `artifacts/posted-delivery-details-desktop-light.png`, `artifacts/posted-delivery-details-desktop-dark.png`, `artifacts/posted-delivery-details-mobile-light.png`, `artifacts/posted-delivery-details-mobile-dark.png` and `artifacts/posted-edit-schedule-breadcrumbs.png`.

The full check passed all 47 tests, formatting, lint, strict types and production builds. The updated UI container passed readiness and delivery/edit/history/scheduled deep routes with CSP, running as UID 1000 on a read-only filesystem with all capabilities dropped and no-new-privileges. Evidence: `artifacts/delivery-details-container.json`. The temporary verification container was removed.

## Connection workflow parity

Removed fixture-specific copy from Add connection. Continue now opens a local provider authorization page, then uses the production callback to save the connected account or return cancellation feedback. The external provider transport is simulated; production still uses configured official OAuth clients. Tests cover all four providers, state/code/verifier checks, expiry, denial, replay, reconnection and administrator role changes.

Desktop dark review approved a new X account and confirmed its Connected row. Mobile light review cancelled Threads and confirmed no account was added. The approval page fits 390px without document overflow and its buttons have 44px targets. Captures: `artifacts/posted-connection-modal-desktop.png`, `artifacts/posted-connection-modal-mobile-light.png`, `artifacts/posted-provider-authorization-desktop.png` and `artifacts/posted-provider-authorization-mobile-light.png`. The full verification passed all 49 tests with no failures or skips, formatting, lint, strict types and production builds.

Fresh API/UI containers passed readiness and connection/authorization deep routes with CSP, UID 1000, read-only filesystems, dropped capabilities and no-new-privileges. The API used an isolated empty schema and returned 404 for the local preview authorization endpoint, confirming the simulated transport is absent from production. Evidence: `artifacts/connection-parity-containers.json`. Temporary containers, environment file and schema were removed.

## Draft saving and navigation

A secondary Save as draft action precedes Post now/Schedule in the composer header. It stays available with no accounts or invalid provider content. Drafts is a separate Posts sidebar entry. Saved drafts reopen in the existing composer with Drafts / short ID / Edit Draft breadcrumbs and their text, account overrides, ordered images and disconnected-account errors preserved. The Drafts list uses a shared table on desktop/mobile and pagination outside it; deletion requires confirmation. Drafts cannot enter the delivery queue. Publishing validates the full payload and marks a source draft as converted within the posting transaction.

Desktop dark review saved a 346-character Bluesky draft while both publishing controls were disabled. Mobile light review reopened it, saved a 334-character account override and reopened that override intact. At 390px, Save as draft precedes the group in one row and all three controls are 44px high. The Drafts table stays within its own horizontal scroll area without document overflow. Captures: `artifacts/posted-save-draft-desktop-dark.png`, `artifacts/posted-save-draft-mobile-light.png`, `artifacts/posted-save-draft-mobile-dark.png` and `artifacts/posted-drafts-mobile-light.png`. All 53 tests passed, including empty/invalid draft storage, image ordering, no worker claims, version/idempotency conflicts, failed publication, atomic conversion and matching MCP permissions/persistence.

A second browser fixture was saved without accounts, reopened, given a Bluesky target and scheduled for October 2027. It moved to Scheduled Posts and disappeared from Drafts. The disposable scheduled delivery was then cancelled through the normal confirmation modal; no delivery worker or external provider request ran. The invalid draft remains available for review. Fresh API/UI containers passed readiness, draft editor/list deep routes with CSP, UID 1000, read-only filesystems and dropped capabilities. The production API saved an empty draft in an isolated schema without creating any delivery jobs. Evidence: `artifacts/drafts-containers.json`. Temporary containers, schema and environment file were removed.

## Mobile pagination alignment

Posted keeps the published managed pagination component and applies the documented HeroUI BEM styling hooks at mobile widths. The summary stays left and Previous/Next stay right on one row, with matching vertical centres and 44px targets. Numbered links/ellipsis are hidden from layout and keyboard navigation on mobile; desktop retains numbered navigation. At 320px and 390px there was no document overflow. A guarded local fixture added 21 drafts to exercise Next, Previous, endpoint disabled states and desktop direct-page selection against the real API; only those temporary drafts were removed afterward. Captures: `artifacts/posted-pagination-320-light.png` and `artifacts/posted-pagination-mobile-dark.png`.

The full check passed all 53 tests, lint, formatting, strict types and production builds. The updated UI image passed readiness and scheduled/history/drafts deep routes with CSP, UID 1000, read-only filesystem, dropped capabilities and no-new-privileges. The temporary container was removed; evidence is in `artifacts/pagination-container.json`.

## Account chooser fades

The modal results list now uses the published vertical ScrollShadow with 24px fades and a hidden scrollbar, matching the horizontal avatar strip. The existing height limit, checkbox selection, search and footer stay intact. Desktop/mobile review checked edge fades while scrolling and their removal when a search reduced the list to one account. Captures: `artifacts/posted-account-list-fade-desktop-dark.png` and `artifacts/posted-account-list-fade-mobile-dark.png`.

All 53 tests, strict types, lint, formatting and production builds passed. The updated UI container passed readiness and the composer route with CSP, UID 1000 and a read-only filesystem with dropped capabilities. The temporary container was removed; evidence is in `artifacts/account-fade-container.json`.

## Drafts-first navigation

The shared sidebar configuration now orders Drafts before Scheduled Posts, followed by Post History. Desktop and 390px mobile navigation preserve the counts and current-page highlighting. Captures: `artifacts/posted-sidebar-drafts-first.png` and `artifacts/posted-sidebar-drafts-first-mobile.png`.

Changed-file formatting/lint, strict typechecking, production UI build and a fresh UI container check passed. Readiness, deep-route CSP, non-root/read-only checks and the navigation order in the built bundle were verified. The temporary container was removed. Evidence: `artifacts/sidebar-order-container.json`.

## Preview content spacing

Removed the preview paragraph's 64px minimum height and reduced media's top margin to 12px. One-line preview text now takes its natural 22.75px height, with a measured 12px gap before the image grid on desktop and 390px mobile. Mobile light/dark review confirmed no document overflow. The saved post was only viewed, without edits.

Changed-file formatting/lint, strict typechecking, production UI build and a fresh non-root/read-only UI container check passed. The built social-preview bundle uses the smaller margin without the fixed paragraph height; readiness, deep route and CSP checks passed. The temporary container was removed. Evidence: `artifacts/preview-gap-container.json`, `artifacts/posted-preview-gap-desktop.png`, `artifacts/posted-preview-gap-mobile-dark.png` and `artifacts/posted-preview-gap-mobile-light.png`.

## Compact single-image preview

Single-image live previews now use an intrinsic-width container capped at 320px and an image capped at 192px tall, preserving aspect ratio without enlarging small originals. Desktop and 390px mobile checks rendered the existing 1275×1275 image at 192×192px; the 240×160 fixture stayed at its natural size. Mobile light/dark review confirmed no document overflow. Temporary image removals were discarded through the editor's navigation guard without saving either scheduled post.

Changed-file formatting/lint, strict typechecking and the production UI build passed. A fresh UI container passed readiness, the details deep route, CSP, UID 1000 and a read-only filesystem with dropped capabilities. Its built social-preview bundle includes the compact bounds. The temporary container was removed. Evidence: `artifacts/single-image-preview-container.json`, `artifacts/posted-single-image-desktop.png`, `artifacts/posted-single-image-mobile-dark.png` and `artifacts/posted-single-image-mobile-light.png`.

## Posted by and Drafted by

Scheduled Posts and Post History now label the existing attribution column Posted by. Drafts have a matching Drafted by column with the last successful saver's shared avatar and name. A new migration backfills only untouched drafts; previously edited drafts show Not recorded until their next successful save. Accepted saves record the actor atomically, while retries, stale edits and attempts to forge attribution leave it unchanged.

Desktop scheduled, history and draft routes and 390px mobile draft scrolling were reviewed. Light/dark mobile checks confirmed the avatar/name column stays inside the scrollable table without document overflow. Captures: `artifacts/posted-by-scheduled-desktop.png`, `artifacts/posted-by-history-desktop.png`, `artifacts/drafted-by-desktop.png`, `artifacts/drafted-by-mobile-dark.png` and `artifacts/drafted-by-mobile-light.png`.

All 67 tests, formatting, lint, strict types and production builds passed. The added database tests cover attribution after a different member saves, non-transfer on replay/rejection, no raw email in the DTO, and honest migration backfill. Fresh API/UI containers passed readiness, deep routes with CSP, non-root/read-only checks and draft save/list attribution after startup migration. The isolated schema and temporary containers were removed; no worker or external publishing ran. Evidence: `artifacts/attribution-containers.json`.

## Delivery details attributes

Requested and Scheduled for now use the published Attributes card above the delivery table, titled Delivery set. The existing user-preference timestamp formatting is preserved, with semantic time elements. Desktop dark and 390px mobile dark/light review confirmed both dates fit without document overflow and table scrolling stays contained. Captures: `artifacts/posted-delivery-attributes-desktop.png`, `artifacts/posted-delivery-attributes-mobile-dark.png` and `artifacts/posted-delivery-attributes-mobile-light.png`.

Changed-file formatting and lint, strict typechecking and the production UI build passed. A fresh UI container passed readiness and the details deep route with CSP, UID 1000, a read-only filesystem and dropped capabilities. The built details bundle contains the Attributes card. The temporary container was removed; evidence is in `artifacts/delivery-attributes-container.json`. No application data was changed.

## Actions column alignment

Connection, scheduled/history and draft tables now use the shared ResourceTable headerClassName contract to right-align Actions with the row controls. Draft action cells also use text-right so a read-only View link follows the same alignment. In the rendered Connections table, the header text and Disconnect button right edges matched at 1244px on desktop and 354px at 390px mobile width after horizontal scrolling, with no document overflow. Captures: `artifacts/posted-actions-header-desktop.png` and `artifacts/posted-actions-header-mobile.png`.

All 53 tests, strict types, lint, formatting and production builds passed. The updated UI container passed readiness and all affected table routes with CSP, UID 1000 and a read-only filesystem with dropped capabilities. The temporary container was removed; evidence is in `artifacts/actions-alignment-container.json`.

## Scheduled title navigation

Scheduled Posts uses the published ResourceTable getRowHref contract to link the first-column title/delivery count to the schedule editor when the current user can edit and all deliveries are still scheduled. Read-only users and posts that have begun delivery link to their details instead. Existing action buttons stay intact. Browser review clicked the Scheduling modal review title and confirmed its Edit Schedule route, loaded content and Scheduled Posts / ID / Edit Schedule breadcrumb without saving a change.

Mobile Enter activation also opened the same editor and restored its master text without changing the post. All 53 tests, strict types, lint, formatting and production builds passed. The updated UI container passed readiness and scheduled/editor deep routes with CSP and non-root/read-only restrictions; the temporary container was removed. Evidence: `artifacts/title-link-container.json` and `artifacts/posted-title-edit-mobile.png`.

## Managed by

Scheduled and history tables use the published UserAvatar and TooltipText primitives to show the last editor beside their name in a dedicated column. Provider icons stay on one line; mobile preserves horizontal table scrolling. Attribution is updated in the same transaction as accepted changes and remains unchanged on retries, rejected edits and worker completion. Legacy migration backfills only untouched sets.

Desktop dark and 390px mobile dark/light checks confirmed the manager column, avatar/initials fallback, one-line provider icons and contained horizontal table scrolling without document overflow. Screenshots: `artifacts/posted-managed-by-desktop.png`, `artifacts/posted-managed-by-mobile.png` and `artifacts/posted-managed-by-history-mobile-light.png`.

All 56 tests, formatting, lint, strict types and production builds passed. Tests cover a different team member editing through REST and MCP, non-transfer on retries/rejections, cancellation attribution, worker completion and honest legacy backfill. Fresh API/UI containers passed readiness, deep routes with CSP, non-root/read-only restrictions and a create-post response identifying the manager after startup migration in an isolated schema. No worker was run. Disposable container data and containers were removed. Evidence: `artifacts/managed-by-containers.json`.

## Sidebar post totals

Scheduled Posts and Drafts use the published SidebarLinkConfig badge contract with numeric totals aligned to the right. Counts include zero after loading, count sets rather than deliveries, and exclude converted drafts. Browser mutations refresh the totals, while five-second foreground polling captures worker and external client changes. The current preview showed six scheduled sets and two drafts in desktop dark and 390px mobile dark/light navigation. Captures: `artifacts/posted-sidebar-counts-desktop.png` and `artifacts/posted-sidebar-counts-mobile.png`.

All 57 tests, formatting, lint, strict types and production builds passed. The new database-backed test covers authenticated/viewer access, empty counts, page-independent draft totals, conversion, active delivery states, cancellation and draft deletion. Fresh API/UI containers passed readiness, CSP routes, non-root/read-only restrictions and authenticated counts of one scheduled set and one draft in an isolated schema. Temporary containers and schema were removed; no worker ran. Evidence: `artifacts/sidebar-counts-containers.json`.

## Video media

The shared upload modal accepts MOV/MP4 alongside still images. Real browser review uploaded a generated 3.2-second MOV through the private storage flow and waited for worker preparation. Both the media strip and social preview loaded the resulting 1280×720 MP4 without autoplay. Space-key playback advanced the native player; inline playback was present. Incompatible image/video combinations marked Bluesky/LinkedIn accounts and disabled publishing, while the same mixed selection enabled Threads. Media errors stay on accounts rather than marking otherwise valid account text invalid.

The Video upload review draft (`9492c466-c068-4e47-8c89-3f04d1be3a18`) preserves the video, image, description and Threads account and reloads with playable previews. Desktop dark and 390px mobile light/dark layouts were reviewed, with no document overflow. The normal browser fixture only processes uploads and does not execute its delivery queue. Captures: `artifacts/posted-video-desktop.png`, `artifacts/posted-video-mobile-light.png` and `artifacts/posted-video-mobile-dark.png`.

All 65 tests, formatting, lint, strict types and production builds passed. Tests cover real video normalization and metadata removal, asynchronous private storage/lease behavior, malformed-file rejection, permission checks, prioritized media combinations, duration limits, MCP video scheduling and each provider's video protocol before the publishing boundary. Remote provider responses are controlled by tests; no live provider post was used.

Fresh API, UI and FFmpeg-equipped worker containers passed readiness, UID 1000, read-only roots, private-media CSP and an actual private MOV upload/preparation/future schedule in an isolated schema and bucket. The smoke test uses a loopback storage relay inside its temporary container namespace, preserving the application's HTTPS-or-loopback storage rule. All temporary containers, bucket objects and the schema were removed. Evidence: `artifacts/video-containers.json`.
