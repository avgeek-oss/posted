import { MediaVideo } from "./media-video.js";
import { GridList, GridListItem, useDragAndDrop } from "react-aria-components";
import { Button, ScrollShadow } from "@posted/web-design-system";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, DragDropVerticalIcon } from "@hugeicons/core-free-icons";
import type { PostMedia } from "../../../packages/contracts/src/index.js";
import { isVideo } from "../../../packages/contracts/src/media.js";
import { reorderMedia } from "./media-order.js";

export type ComposerMediaItem = PostMedia & { url?: string };

export function ComposerMedia({
  media,
  disabled,
  onChange,
}: {
  media: ComposerMediaItem[];
  disabled: boolean;
  onChange: (media: ComposerMediaItem[]) => void;
}) {
  const { dragAndDropHooks } = useDragAndDrop<ComposerMediaItem>({
    isDisabled: disabled,
    getItems: (_keys, items) =>
      items.map((image) => ({ "application/x-posted-media": image.id })),
    onReorder: ({ keys, target }) => {
      if (target.dropPosition === "before" || target.dropPosition === "after")
        onChange(reorderMedia(media, keys, target.key, target.dropPosition));
    },
  });
  return (
    <ScrollShadow
      orientation="horizontal"
      hideScrollBar
      size={24}
      className="min-w-0 overflow-x-auto overscroll-x-contain p-1"
    >
      <GridList
        aria-label="Post media"
        layout="grid"
        orientation="horizontal"
        items={media}
        dependencies={[disabled]}
        dragAndDropHooks={dragAndDropHooks}
        className="composer-media relative grid grid-flow-col auto-cols-[calc((100%_-_12px)/2)] gap-3 sm:auto-cols-[calc((100%_-_36px)/4)]"
      >
        {(image) => (
          <GridListItem
            id={image.id}
            textValue={image.fileName}
            className="composer-image relative min-w-0 overflow-hidden rounded-xl border border-separator bg-surface outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-accent data-[dragging]:opacity-50"
          >
            <div className="aspect-[4/3] bg-default">
              {image.url ? (
                isVideo(image) ? (
                  <MediaVideo
                    src={image.url}
                    label={image.alt || image.fileName}
                    className="size-full object-contain"
                  />
                ) : (
                  <img
                    src={image.url}
                    alt={image.alt || image.fileName}
                    draggable={false}
                    className="size-full object-cover"
                  />
                )
              ) : (
                <span className="flex h-full items-center justify-center text-xs text-muted">
                  Loading preview…
                </span>
              )}
            </div>
            <div className="flex min-w-0 items-center gap-1 px-2 py-1">
              <Button
                slot="drag"
                isIconOnly
                size="sm"
                variant="ghost"
                className="size-6 min-w-0 shrink-0 touch-none cursor-grab bg-transparent p-0 hover:bg-transparent data-[hovered=true]:bg-transparent active:cursor-grabbing"
                aria-label={`Reorder ${image.fileName}`}
                isDisabled={disabled}
              >
                <HugeiconsIcon
                  icon={DragDropVerticalIcon}
                  size={14}
                  aria-hidden
                />
              </Button>
              <p
                className="min-w-0 truncate text-xs font-medium"
                title={image.fileName}
              >
                {image.fileName}
              </p>
            </div>
            <Button
              isIconOnly
              variant="secondary"
              size="sm"
              className="absolute right-1 top-1"
              aria-label={`Remove ${image.fileName}`}
              isDisabled={disabled}
              onPress={() =>
                onChange(media.filter((item) => item.id !== image.id))
              }
            >
              <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden />
            </Button>
          </GridListItem>
        )}
      </GridList>
    </ScrollShadow>
  );
}
