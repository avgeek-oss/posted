import { memo, useRef, useState } from "react";
import { MediaVideo } from "./media-video.js";
import {
  DropIndicator,
  GridList,
  GridListItem,
  useDragAndDrop,
} from "react-aria-components";
import { Button, Chip, Dialog, ScrollShadow } from "@posted/web-design-system";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  DragDropVerticalIcon,
  PlayIcon,
} from "@hugeicons/core-free-icons";
import type { PostMedia } from "../../../packages/contracts/src/index.js";
import { isGif, isVideo } from "../../../packages/contracts/src/media.js";
import { reorderItems } from "./item-order.js";

export type ComposerMediaItem = PostMedia & {
  url?: string;
  thumbnailUrl?: string;
};

const mediaSizeFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});

function formatMediaSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${mediaSizeFormat.format(bytes / 1024)} KB`;
  return `${mediaSizeFormat.format(bytes / 1024 ** 2)} MB`;
}

function formatMediaDuration(duration: number) {
  const seconds = Math.round(duration);
  return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
}

export const ComposerMedia = memo(function ComposerMedia({
  media,
  disabled,
  onChange,
}: {
  media: ComposerMediaItem[];
  disabled: boolean;
  onChange: (media: ComposerMediaItem[]) => void;
}) {
  const handlePressed = useRef(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = media.find((item) => item.id === previewId);
  const { dragAndDropHooks } = useDragAndDrop<ComposerMediaItem>({
    isDisabled: disabled,
    getItems: (_keys, items) =>
      items.map((image) => ({ "application/x-posted-media": image.id })),
    renderDropIndicator: (target) => {
      const index =
        target.type === "item"
          ? media.findIndex((item) => item.id === target.key)
          : 0;
      return (
        <DropIndicator
          target={target}
          className="composer-media-drop-indicator"
          style={{
            gridColumn: `${index + 1} / ${index + 2}`,
            gridRow: 1,
            insetInlineStart:
              target.type === "item" && target.dropPosition === "after"
                ? "calc(100% + 6px)"
                : "-6px",
          }}
        />
      );
    },
    onReorder: ({ keys, target }) => {
      if (target.dropPosition === "before" || target.dropPosition === "after")
        onChange(reorderItems(media, keys, target.key, target.dropPosition));
    },
  });
  return (
    <div
      className="min-w-0"
      onPointerDownCapture={(event) => {
        handlePressed.current =
          event.target instanceof Element &&
          !!event.target.closest("[data-media-drag-handle]");
      }}
      onDragStartCapture={(event) => {
        if (
          event.target instanceof Element &&
          event.target.matches(".composer-image") &&
          !handlePressed.current
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onDragEndCapture={() => {
        handlePressed.current = false;
      }}
    >
      <ScrollShadow
        orientation="horizontal"
        hideScrollBar
        size={24}
        className="-mx-2 min-w-0 overflow-x-auto overscroll-x-contain px-2 py-1"
      >
        <GridList
          aria-label="Post media"
          layout="stack"
          orientation="horizontal"
          keyboardNavigationBehavior="tab"
          disallowTypeAhead
          items={media}
          dependencies={[disabled, media, onChange]}
          dragAndDropHooks={dragAndDropHooks}
          className="composer-media relative grid auto-cols-[10rem] grid-flow-col gap-3 sm:auto-cols-[9rem]"
        >
          {(image) => (
            <GridListItem
              id={image.id}
              textValue={image.fileName}
              className="composer-image relative min-w-0 overflow-hidden rounded-xl border border-separator bg-surface outline-none data-[dragging]:opacity-50"
            >
              <Button
                variant="ghost"
                className="composer-media-preview relative block aspect-[4/3] h-auto w-full min-w-0 transform-none overflow-hidden rounded-none bg-default p-0 hover:bg-default active:transform-none data-[hovered=true]:bg-default data-[pressed=true]:transform-none"
                aria-label={`Preview ${image.fileName}`}
                isDisabled={!image.url}
                onPress={() => setPreviewId(image.id)}
              >
                {image.url ? (
                  isVideo(image) ? (
                    <MediaVideo
                      src={image.url}
                      label={image.alt || image.fileName}
                      controls={false}
                      className="pointer-events-none size-full object-contain"
                    />
                  ) : (
                    <img
                      src={image.thumbnailUrl ?? image.url}
                      alt={image.alt || image.fileName}
                      draggable={false}
                      loading="lazy"
                      decoding="async"
                      width={image.width}
                      height={image.height}
                      className="size-full object-cover"
                    />
                  )
                ) : (
                  <span className="flex h-full items-center justify-center text-xs text-muted">
                    Loading preview…
                  </span>
                )}
                {isVideo(image) && image.url && (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span className="flex size-7 items-center justify-center rounded-full bg-foreground/60 text-background">
                      <HugeiconsIcon icon={PlayIcon} size={16} aria-hidden />
                    </span>
                  </span>
                )}
                {isGif(image) && (
                  <span className="pointer-events-none absolute bottom-1 right-1 rounded-full bg-surface">
                    <Chip size="sm" color="accent" variant="soft">
                      <Chip.Label>GIF</Chip.Label>
                    </Chip>
                  </span>
                )}
              </Button>
              <div className="flex min-w-0 items-center gap-1 py-1 pl-1 pr-2">
                <Button
                  slot="drag"
                  data-media-drag-handle
                  style={{ pointerEvents: "auto" }}
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  className="group/media-drag-handle size-6 min-w-0 shrink-0 touch-none cursor-grab bg-transparent p-0 text-foreground hover:bg-transparent data-[hovered=true]:bg-transparent active:cursor-grabbing"
                  aria-label={`Reorder ${image.fileName}`}
                  isDisabled={disabled}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-transparent group-hover/media-drag-handle:border-separator group-hover/media-drag-handle:bg-default group-data-[hovered=true]/media-drag-handle:border-separator group-data-[hovered=true]/media-drag-handle:bg-default group-data-[focus-visible=true]/media-drag-handle:bg-default">
                    <HugeiconsIcon
                      icon={DragDropVerticalIcon}
                      size={16}
                      className="size-4"
                      aria-hidden
                    />
                  </span>
                </Button>
                <p
                  className="min-w-0 truncate text-sm leading-4 font-medium sm:text-xs"
                  title={image.fileName}
                >
                  {image.fileName}
                </p>
              </div>
              <Button
                isIconOnly
                variant="secondary"
                size="sm"
                className="composer-media-remove absolute right-1 top-1 size-6 min-w-0 bg-transparent p-0 hover:bg-transparent data-[hovered=true]:bg-transparent"
                aria-label={`Remove ${image.fileName}`}
                isDisabled={disabled}
                onPress={() =>
                  onChange(media.filter((item) => item.id !== image.id))
                }
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface/70">
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    size={12}
                    className="size-3"
                    aria-hidden
                  />
                </span>
              </Button>
            </GridListItem>
          )}
        </GridList>
      </ScrollShadow>
      <Dialog
        open={!!preview?.url}
        onClose={() => setPreviewId(null)}
        title={
          preview ? (
            <span className="flex flex-wrap items-center gap-2 pr-6">
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {preview.fileName}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                <Chip size="sm" variant="soft" color="accent">
                  <Chip.Label>
                    {preview.width} × {preview.height} px
                  </Chip.Label>
                </Chip>
                <Chip size="sm" variant="soft" color="accent">
                  <Chip.Label>{formatMediaSize(preview.sizeBytes)}</Chip.Label>
                </Chip>
                {(isVideo(preview) || isGif(preview)) &&
                  preview.durationSeconds !== null && (
                    <Chip
                      size="sm"
                      variant="soft"
                      color="accent"
                      aria-label={`Duration: ${formatMediaDuration(preview.durationSeconds)}`}
                    >
                      <Chip.Label>
                        {formatMediaDuration(preview.durationSeconds)}
                      </Chip.Label>
                    </Chip>
                  )}
              </span>
            </span>
          ) : (
            "Media preview"
          )
        }
        wide
        className="w-[calc(100vw-2rem)] max-w-4xl"
      >
        {preview?.url && (
          <div className="flex min-w-0 items-center justify-center overflow-hidden rounded-xl bg-default">
            {isVideo(preview) ? (
              <MediaVideo
                key={preview.id}
                src={preview.url}
                label={preview.alt || preview.fileName}
                className="max-h-[70dvh] w-full object-contain"
              />
            ) : (
              <img
                src={preview.url}
                alt={preview.alt || preview.fileName}
                width={preview.width}
                height={preview.height}
                decoding="async"
                className="max-h-[70dvh] w-full object-contain"
              />
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
});
