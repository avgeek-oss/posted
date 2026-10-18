import { lazy, Suspense, useCallback, useId } from "react";
import { Card } from "@heroui/react";
import { useFocusVisible } from "react-aria";
import { Button, Dropdown, Label, TextField } from "@posted/web-design-system";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AttachmentIcon,
  Cancel01Icon,
  ArrowDown01Icon,
  DragDropVerticalIcon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons";
import type { ComposerMediaItem } from "./composer-media.js";
import { AddMediaButton } from "./add-media-button.js";

export type ComposerPart = {
  id: string;
  text: string;
  textOverrides: Record<string, string>;
  media: ComposerMediaItem[];
  mediaOverrides: Record<string, ComposerMediaItem[]>;
};

const ComposerMedia = lazy(() =>
  import("./composer-media.js").then((module) => ({
    default: module.ComposerMedia,
  })),
);
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });

export function MasterPostEditor({
  part,
  index,
  total,
  expanded,
  autoFocus,
  onFocus,
  locked,
  uploading,
  storageEnabled,
  onActivate,
  onChange,
  onUpload,
  onRemove,
  onInsert,
  onMove,
}: {
  part: ComposerPart;
  index: number;
  total: number;
  expanded: boolean;
  autoFocus: boolean;
  onFocus: () => void;
  locked: boolean;
  uploading: boolean;
  storageEnabled: boolean;
  onActivate: () => void;
  onChange: (id: string, change: Partial<ComposerPart>) => void;
  onUpload: () => void;
  onRemove: () => void;
  onInsert: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const changeMedia = useCallback(
    (media: ComposerMediaItem[]) => onChange(part.id, { media }),
    [part.id, onChange],
  );
  const contentId = useId();
  const { isFocusVisible } = useFocusVisible();
  const disabled = locked || uploading;
  const characterCount = [...part.text].length;
  const wordCount = [...wordSegmenter.segment(part.text)].filter(
    (segment) => segment.isWordLike,
  ).length;
  return (
    <Card
      className="min-w-0"
      id={`master-post-${part.id}`}
      data-keyboard={isFocusVisible || undefined}
    >
      <Card.Content className="grid min-w-0 gap-0">
        {total > 1 && (
          <div className="-ml-1 flex min-w-0 items-start gap-1">
            <Button
              slot="drag"
              data-post-drag-handle
              style={{ pointerEvents: "auto" }}
              isIconOnly
              variant="ghost"
              size="sm"
              className="size-7 min-w-0 shrink-0 touch-none cursor-grab p-0 active:cursor-grabbing"
              aria-label={`Reorder post ${index + 1}`}
              isDisabled={disabled}
            >
              <HugeiconsIcon
                icon={DragDropVerticalIcon}
                size={16}
                aria-hidden
              />
            </Button>
            <div className="min-w-0 flex-1">
              <h2 className="flex min-h-7 flex-wrap items-center gap-x-1 text-sm font-medium max-sm:min-h-11">
                <span className="whitespace-nowrap">
                  Post {index + 1} of {total}
                </span>
                <span className="font-normal text-muted tabular-nums">
                  ({characterCount} {characterCount === 1 ? "char" : "chars"} /{" "}
                  {wordCount} {wordCount === 1 ? "word" : "words"})
                </span>
              </h2>
              <div
                className="composer-post-disclosure"
                data-expanded={!expanded}
                aria-hidden={expanded}
              >
                <div className="min-h-0 min-w-0 overflow-hidden">
                  <p className="whitespace-pre-wrap text-sm text-muted [overflow-wrap:anywhere]">
                    {part.text.trim() ? part.text : "No text yet"}
                  </p>
                </div>
              </div>
            </div>
            <Button
              isIconOnly
              variant="ghost"
              size="sm"
              className="size-7 min-w-0 shrink-0 p-0"
              aria-expanded={expanded}
              aria-controls={contentId}
              aria-label={`${expanded ? "Collapse" : "Expand"} post ${index + 1}`}
              onPress={onActivate}
            >
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                size={16}
                aria-hidden
                className="composer-post-chevron"
                data-expanded={expanded}
              />
            </Button>
            <Dropdown>
              <Button
                isIconOnly
                variant="ghost"
                size="sm"
                className="size-7 min-w-0 shrink-0 p-0"
                aria-label={`Actions for post ${index + 1}`}
                isDisabled={disabled}
              >
                <HugeiconsIcon
                  icon={MoreHorizontalIcon}
                  size={16}
                  aria-hidden
                />
              </Button>
              <Dropdown.Popover>
                <Dropdown.Menu
                  aria-label={`Post ${index + 1} actions`}
                  disabledKeys={[
                    ...(index === 0 ? ["up"] : []),
                    ...(index === total - 1 ? ["down"] : []),
                  ]}
                  onAction={(key) =>
                    key === "insert"
                      ? onInsert()
                      : onMove(key === "up" ? -1 : 1)
                  }
                >
                  <Dropdown.Item id="up" textValue="Move up">
                    <Label>Move up</Label>
                  </Dropdown.Item>
                  <Dropdown.Item id="down" textValue="Move down">
                    <Label>Move down</Label>
                  </Dropdown.Item>
                  <Dropdown.Item id="insert" textValue="Insert post after">
                    <Label>Insert post after</Label>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
            <Button
              isIconOnly
              variant="ghost"
              size="sm"
              className="size-7 min-w-0 shrink-0 p-0"
              aria-label={`Remove post ${index + 1}`}
              isDisabled={disabled}
              onPress={onRemove}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden />
            </Button>
          </div>
        )}
        {!!part.media.length && (
          <div
            className="composer-post-disclosure"
            data-expanded={!expanded}
            aria-hidden={expanded}
          >
            <div className="min-h-0 overflow-clip [overflow-clip-margin:4px]">
              <div
                className="flex items-center gap-2 pt-3 pl-7 max-sm:pl-11"
                aria-label={`${part.media.length} media files`}
              >
                {part.media.slice(0, 3).map((image) =>
                  image.url && image.contentType.startsWith("image/") ? (
                    <img
                      key={image.id}
                      src={image.url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      width={36}
                      height={36}
                      className="size-9 rounded-md object-cover"
                    />
                  ) : (
                    <span
                      key={image.id}
                      className="flex size-9 items-center justify-center rounded-md bg-default"
                      aria-hidden="true"
                    >
                      <HugeiconsIcon icon={AttachmentIcon} size={16} />
                    </span>
                  ),
                )}
                <span className="text-xs text-muted">
                  {part.media.length}{" "}
                  {part.media.length === 1 ? "file" : "files"}
                </span>
              </div>
            </div>
          </div>
        )}
        <div
          id={contentId}
          className="composer-post-disclosure"
          data-expanded={expanded}
          aria-hidden={!expanded}
          inert={!expanded}
        >
          <div className="-m-1 min-h-0 overflow-hidden">
            <div className="p-1">
              <div className={`grid min-w-0 gap-3 ${total > 1 ? "pt-3" : ""}`}>
                <TextField
                  label={
                    total > 1
                      ? `Master text for post ${index + 1}`
                      : "Master text"
                  }
                  hideLabel
                  autoFocus={autoFocus}
                  onFocus={onFocus}
                  value={part.text}
                  onChange={(event) =>
                    onChange(part.id, { text: event.target.value })
                  }
                  multiline
                  rows={total > 1 ? 6 : 12}
                  maxLength={3000}
                  disabled={locked}
                  variant="secondary"
                  placeholder="What do you want to share?"
                  className={`${total > 1 ? "min-h-40" : "min-h-72"} resize-y`}
                />
                {!!part.media.length && (
                  <Suspense
                    fallback={
                      <p className="text-xs text-muted" role="status">
                        Loading media…
                      </p>
                    }
                  >
                    <ComposerMedia
                      media={part.media}
                      disabled={disabled}
                      onChange={changeMedia}
                    />
                  </Suspense>
                )}
                <AddMediaButton
                  onPress={onUpload}
                  storageEnabled={storageEnabled}
                  disabled={disabled || part.media.length >= 20}
                />
              </div>
            </div>
          </div>
        </div>
      </Card.Content>
    </Card>
  );
}
