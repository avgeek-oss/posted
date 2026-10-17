import { MediaVideo } from "./media-video.js";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkCircle02Icon,
  Clock01Icon,
  CancelCircleIcon,
  InformationCircleIcon,
  MoreHorizontalIcon,
  Comment01Icon,
  FavouriteIcon,
  RepeatIcon,
  Share08Icon,
  ThumbsUpIcon,
  Bookmark02Icon,
  TriangleAlertIcon,
} from "@hugeicons/core-free-icons";
import { Chip, TooltipText } from "@posted/web-design-system";
import { textForProviderPreview } from "../../../packages/contracts/src/text.js";
import { supportsThreads } from "../../../packages/contracts/src/threads.js";
import type {
  Provider,
  SocialConnection,
  PostState,
  DeliveryState,
} from "../../../packages/contracts/src/index.js";

export const providerNames: Record<Provider, string> = {
  x: "X",
  linkedin: "LinkedIn",
  bluesky: "Bluesky",
  threads: "Threads",
};
export function ProviderIcon({
  provider,
  className = "size-4",
}: {
  provider: Provider;
  className?: string;
}) {
  return (
    <img
      src={`/providers/${provider}.svg`}
      alt=""
      aria-hidden="true"
      width={16}
      height={16}
      className={`${className} shrink-0 rounded-sm object-contain`}
    />
  );
}
export function StateChip({
  state,
}: {
  state: PostState | DeliveryState | SocialConnection["state"];
}) {
  const success = ["published", "connected"].includes(state);
  const danger = ["failed", "disconnected"].includes(state);
  const warning = [
    "uncertain",
    "partial",
    "reauthentication_required",
  ].includes(state);
  const title =
    state === "reauthentication_required"
      ? "Reconnect needed"
      : state.charAt(0).toUpperCase() + state.slice(1);
  return (
    <Chip
      size="sm"
      color={
        success
          ? "success"
          : danger
            ? "danger"
            : warning || state === "scheduled"
              ? "warning"
              : "default"
      }
      variant="soft"
    >
      <HugeiconsIcon
        icon={
          success
            ? CheckmarkCircle02Icon
            : danger
              ? CancelCircleIcon
              : warning
                ? InformationCircleIcon
                : Clock01Icon
        }
        size={14}
        aria-hidden
      />
      <Chip.Label>{title}</Chip.Label>
    </Chip>
  );
}
export type PreviewMedia = {
  id: string;
  url: string;
  alt: string;
  contentType: string;
  durationSeconds: number | null;
  width: number;
  height: number;
};
export function SocialSequencePreview({
  account,
  posts,
}: {
  account: SocialConnection;
  posts: { text: string; media: PreviewMedia[] }[];
}) {
  const threaded = posts.length > 1 && supportsThreads(account.provider);
  return (
    <ol
      className="grid min-w-0 gap-6"
      aria-label={threaded ? "Thread preview" : "Post previews"}
    >
      {posts.map((post, index) => (
        <li key={index} className="grid min-w-0 gap-2">
          {posts.length > 1 && (
            <p
              className={`relative text-xs text-muted ${threaded ? "pl-14" : ""}`}
            >
              {threaded && index > 0 && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -top-6 -bottom-2 left-8 w-px bg-separator"
                />
              )}
              Post {index + 1} of {posts.length}
              {threaded && index > 0 ? ` · Reply to @${account.handle}` : ""}
            </p>
          )}
          <SocialPreview
            account={account}
            text={post.text}
            media={post.media}
          />
        </li>
      ))}
    </ol>
  );
}
export function SocialPreview({
  account,
  text,
  media,
}: {
  account: SocialConnection;
  text: string;
  media: PreviewMedia[];
}) {
  const linkedIn = account.provider === "linkedin";
  const x = account.provider === "x";
  const singleImage =
    media.length === 1 && media[0]?.contentType.startsWith("image/");
  const actions = linkedIn
    ? [
        { icon: ThumbsUpIcon, label: "Like" },
        { icon: Comment01Icon, label: "Comment" },
        { icon: RepeatIcon, label: "Repost" },
        { icon: Share08Icon, label: "Send" },
      ]
    : (account.provider === "threads"
        ? [FavouriteIcon, Comment01Icon, RepeatIcon, Share08Icon]
        : x
          ? [
              Comment01Icon,
              RepeatIcon,
              FavouriteIcon,
              Bookmark02Icon,
              Share08Icon,
            ]
          : [Comment01Icon, RepeatIcon, FavouriteIcon, Share08Icon]
      ).map((icon) => ({ icon, label: "" }));
  return (
    <article
      className="overflow-hidden rounded-2xl border border-separator bg-surface shadow-none"
      aria-label={`${providerNames[account.provider]} preview for ${account.name}`}
    >
      <div className="p-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-default text-sm leading-none font-medium">
            {account.avatarUrl ? (
              <img
                src={account.avatarUrl}
                alt=""
                className="size-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              account.name
                .split(/\s+/)
                .slice(0, 2)
                .map((word) => word[0])
                .join("")
                .toUpperCase()
            )}
          </div>
          <div className="grid min-w-0 flex-1 content-center gap-0.5">
            <p className="truncate text-base leading-5 font-medium">
              {account.name}
            </p>
            <p className="truncate text-xs leading-4 text-muted">
              {linkedIn ? "Just now · Public" : `@${account.handle} · now`}
            </p>
          </div>
          <HugeiconsIcon
            icon={MoreHorizontalIcon}
            size={18}
            className="text-muted"
            aria-hidden
          />
        </div>
        {(text.trim() || !media.length) && (
          <p
            className={`mt-4 whitespace-pre-wrap break-words leading-relaxed ${x ? "text-lg" : "text-sm"} ${!text.trim() ? "text-muted" : ""}`}
          >
            {text.trim() ? (
              textForProviderPreview(account.provider, text)
            ) : (
              <span className="flex items-center gap-2">
                <TooltipText
                  tooltip={
                    <span className="block max-w-56 whitespace-normal">
                      Post copy missing, type in the composer to reflect in the
                      preview.
                    </span>
                  }
                  openOnPress
                  tabIndex={0}
                  aria-label="Post copy missing"
                  className="inline-flex shrink-0 rounded-sm text-danger outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <HugeiconsIcon
                    icon={TriangleAlertIcon}
                    size={16}
                    aria-hidden
                  />
                </TooltipText>
                <em className="italic">Your post will appear here.</em>
              </span>
            )}
          </p>
        )}
        {!!media.length && (
          <div
            className={`mt-3 grid overflow-hidden rounded-xl border border-separator ${media.length > 1 ? "grid-cols-2 gap-0.5" : "grid-cols-1"} ${singleImage ? "w-fit max-w-80" : ""}`}
          >
            {media.slice(0, 4).map((image, index) => (
              <div key={image.id} className="relative bg-default">
                {image.contentType.startsWith("video/") ? (
                  <MediaVideo
                    src={image.url}
                    label={image.alt || "Post video"}
                    className="aspect-video w-full object-contain"
                  />
                ) : (
                  <img
                    src={image.url}
                    alt={image.alt || "Post image"}
                    loading="lazy"
                    decoding="async"
                    width={image.width}
                    height={image.height}
                    className={
                      media.length === 1
                        ? "max-h-48 max-w-full w-auto object-contain"
                        : "aspect-video w-full object-cover"
                    }
                  />
                )}
                {index === 3 && media.length > 4 && (
                  <span className="absolute inset-0 flex items-center justify-center bg-foreground/60 text-2xl text-background">
                    +{media.length - 4}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div
        className="flex items-center justify-between border-t border-separator p-3 text-muted"
        aria-hidden
      >
        {actions.map(({ icon, label }, index) => (
          <span
            key={index}
            className="inline-flex items-center gap-1.5 text-xs"
          >
            <HugeiconsIcon icon={icon} size={16} strokeWidth={1.5} />
            {label}
          </span>
        ))}
      </div>
    </article>
  );
}
