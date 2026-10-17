import { lazy, Suspense, useCallback } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { AttachmentIcon } from "@hugeicons/core-free-icons";
import { Button, TextField } from "@posted/web-design-system";
import type { SocialConnection } from "../../../packages/contracts/src/index.js";
import {
  characterLimits,
  providerTextLength,
} from "../../../packages/contracts/src/text.js";
import type { ComposerPart } from "./composer-post.js";

const ComposerMedia = lazy(() =>
  import("./composer-media.js").then((module) => ({
    default: module.ComposerMedia,
  })),
);

export function ComposerAccountEditor({
  part,
  index,
  total,
  account,
  locked,
  uploading,
  storageEnabled,
  onUpload,
  error,
  onReset,
  onChange,
  inputRef,
}: {
  part: ComposerPart;
  index: number;
  total: number;
  account: SocialConnection;
  locked: boolean;
  uploading: boolean;
  storageEnabled: boolean;
  onUpload: () => void;
  error: string;
  onReset: () => void;
  onChange: (id: string, change: Partial<ComposerPart>) => void;
  inputRef: (node: HTMLTextAreaElement | null) => void;
}) {
  const custom =
    part.textOverrides[account.id] !== undefined ||
    part.mediaOverrides[account.id] !== undefined;
  const media = part.mediaOverrides[account.id] ?? part.media;
  const changeMedia = useCallback(
    (items: typeof media) =>
      onChange(part.id, {
        mediaOverrides: { ...part.mediaOverrides, [account.id]: items },
      }),
    [part.id, part.mediaOverrides, account.id, onChange],
  );
  const value = part.textOverrides[account.id] ?? part.text;
  return (
    <li className="grid min-w-0 gap-2">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-medium">
          Post {index + 1} of {total}
        </h3>
        {custom && (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto min-w-0 rounded-none bg-transparent p-0 text-xs font-normal text-muted underline decoration-dashed underline-offset-4 hover:bg-transparent hover:text-foreground data-[hovered=true]:bg-transparent data-[hovered=true]:text-foreground"
            isDisabled={locked || uploading}
            aria-label={`Reset post ${index + 1} to master`}
            onPress={onReset}
          >
            Reset to master
          </Button>
        )}
      </div>
      <div className="grid min-w-0 gap-1">
        <TextField
          ref={inputRef}
          label={`Account text for post ${index + 1}`}
          hideLabel
          multiline
          value={value}
          onChange={(event) =>
            onChange(part.id, {
              textOverrides: {
                ...part.textOverrides,
                [account.id]: event.target.value,
              },
            })
          }
          maxLength={3000}
          disabled={locked}
          aria-invalid={!!error}
          variant="secondary"
          rows={4}
          className="min-h-28 resize-y"
        />
        <p
          className={`text-xs tabular-nums ${error ? "text-danger" : "text-muted"}`}
        >
          {providerTextLength(account.provider, value)}/
          {characterLimits[account.provider]} characters
          {error && `. ${error}`}
        </p>
      </div>
      {!!media.length && (
        <Suspense
          fallback={
            <p className="text-xs text-muted" role="status">
              Loading media…
            </p>
          }
        >
          <ComposerMedia
            media={media}
            disabled={locked || uploading}
            onChange={changeMedia}
          />
        </Suspense>
      )}
      <div>
        <Button
          variant="secondary"
          onPress={onUpload}
          isDisabled={
            locked || uploading || !storageEnabled || media.length >= 20
          }
        >
          <HugeiconsIcon icon={AttachmentIcon} size={16} aria-hidden />
          Add media
        </Button>
      </div>
    </li>
  );
}
