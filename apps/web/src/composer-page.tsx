import {
  characterLimits,
  providerTextLength,
} from "../../../packages/contracts/src/text.js";
import {
  mediaForProvider,
  mediaError,
  videoUploadBytes,
} from "../../../packages/contracts/src/media.js";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  now,
  parseAbsolute,
  type ZonedDateTime,
} from "@internationalized/date";
import {
  ButtonGroup,
  Calendar,
  Card,
  DateField,
  DatePicker,
  FieldError,
  Label,
} from "@heroui/react";
import {
  Button,
  Dialog,
  Dropdown,
  FileUpload,
  TextField,
  toast,
} from "@posted/web-design-system";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AttachmentIcon,
  Calendar03Icon,
  ArrowDown01Icon,
  Edit02Icon,
  SentIcon,
  FloppyDiskIcon,
} from "@hugeicons/core-free-icons";
import type {
  Post,
  PostMedia,
  PostInput,
  SocialConnection,
  PostDraft,
  DraftInput,
} from "../../../packages/contracts/src/index.js";
import {
  ApiError,
  api,
  errorText,
  navigate,
  type NavigationRequest,
  type Session,
} from "./api.js";
import { PageHeading } from "./page-heading.js";
import {
  providerNames,
  SocialPreview,
  type PreviewMedia,
} from "./social-ui.js";

import { ComposerAccounts } from "./composer-accounts.js";
import type { ComposerMediaItem } from "./composer-media.js";

const ComposerMedia = lazy(() =>
  import("./composer-media.js").then((module) => ({
    default: module.ComposerMedia,
  })),
);

type MediaConfiguration = {
  enabled: boolean;
  maxBytes: number;
  contentTypes: string[];
};
function draftSignature(
  text: string,
  accounts: string[],
  media: ComposerMediaItem[],
  mode: string,
  date: ZonedDateTime,
  textOverrides: Record<string, string> = {},
) {
  return JSON.stringify({
    text,
    textOverrides: Object.fromEntries(
      accounts
        .filter((id) => textOverrides[id] !== undefined)
        .sort()
        .map((id) => [id, textOverrides[id]]),
    ),
    accounts: [...accounts].sort(),
    media: media.map((image) => image.id),
    mode,
    date: mode === "schedule" ? date.toDate().toISOString() : null,
  });
}

export function ComposerPage({
  postId,
  draftId,
  initialText,
  canEdit,
  session,
  onSubmitted,
}: {
  postId?: string;
  draftId?: string;
  initialText: string;
  canEdit: boolean;
  session: Session;
  onSubmitted: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [textOverrides, setTextOverrides] = useState<Record<string, string>>(
    {},
  );
  const [accounts, setAccounts] = useState<SocialConnection[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [media, setMedia] = useState<ComposerMediaItem[]>([]);
  const [configuration, setConfiguration] = useState<MediaConfiguration | null>(
    null,
  );
  const [mode, setMode] = useState(postId ? "schedule" : "now");
  const [date, setDate] = useState(() =>
    now(session.user.timeZone)
      .add({ hours: 1 })
      .set({ second: 0, millisecond: 0 }),
  );
  const [post, setPost] = useState<Post | null>(null);
  const [savedDraft, setSavedDraft] = useState<PostDraft | null>(null);
  const [draftRetry, setDraftRetry] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [postNowOpen, setPostNowOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<ZonedDateTime | null>(date);
  const [alt, setAlt] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const [previewId, setPreviewId] = useState("");
  const [leave, setLeave] = useState<NavigationRequest | null>(null);
  const accountText = useRef<HTMLTextAreaElement>(null);
  const key = useRef<string>(crypto.randomUUID());
  const retry = useRef<PostInput | null>(null);
  const draftSave = useRef<{ id: string; input: DraftInput } | null>(null);
  const skipGuard = useRef(false);
  const baseline = useRef(
    draftSignature(initialText, [], [], postId ? "schedule" : "now", date),
  );
  const dirty =
    draftSignature(text, selected, media, mode, date, textOverrides) !==
    baseline.current;
  const editablePost =
    !postId ||
    (!!post &&
      post.deliveries.every((delivery) => delivery.state === "scheduled"));
  const locked = !canEdit || !editablePost || busy || ambiguous;
  const chosen = accounts.filter((account) => selected.includes(account.id));
  const invalidAccounts = chosen.filter(
    (account) =>
      providerTextLength(account.provider, textOverrides[account.id] ?? text) >
      characterLimits[account.provider],
  );
  const accountErrors: Record<string, string> = Object.fromEntries(
    chosen.flatMap((account) => {
      const value = textOverrides[account.id] ?? text;
      const error =
        account.state !== "connected"
          ? "Reconnect this account before posting."
          : providerTextLength(account.provider, value) >
              characterLimits[account.provider]
            ? `${providerNames[account.provider]} supports up to ${characterLimits[account.provider]} characters.`
            : !value.trim() && !media.length
              ? "Add text or media for this account."
              : mediaError(account.provider, media);
      return error ? [[account.id, error]] : [];
    }),
  );
  const hasAccountErrors = Object.keys(accountErrors).length > 0;
  const preview =
    chosen.find((account) => account.id === previewId) ?? chosen[0];
  const mediaIds = media
    .map((image) => image.id)
    .sort()
    .join(",");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setFailed(false);
      try {
        const [connections, storage, existing, existingDraft] =
          await Promise.all([
            api<{ items: SocialConnection[] }>(
              "/connections",
              undefined,
              "GET",
              {
                signal: controller.signal,
              },
            ),
            api<MediaConfiguration>("/media/config", undefined, "GET", {
              signal: controller.signal,
            }),
            postId
              ? api<{ post: Post }>(`/posts/${postId}`, undefined, "GET", {
                  signal: controller.signal,
                })
              : Promise.resolve(null),
            draftId
              ? api<{ draft: PostDraft }>(
                  `/drafts/${draftId}`,
                  undefined,
                  "GET",
                  { signal: controller.signal },
                )
              : Promise.resolve(null),
          ]);
        if (controller.signal.aborted) return;
        setAccounts(connections.items);
        setConfiguration(storage);
        if (existingDraft) {
          const stored = existingDraft.draft;
          setSavedDraft(stored);
          setText(stored.text);
          setTextOverrides(stored.textOverrides);
          setSelected(stored.connectionIds);
          setMedia(stored.media);
          setAccounts([
            ...connections.items,
            ...stored.connections.filter(
              (account) =>
                !connections.items.some((current) => current.id === account.id),
            ),
          ]);
          baseline.current = draftSignature(
            stored.text,
            stored.connectionIds,
            stored.media,
            "now",
            date,
            stored.textOverrides,
          );
        }
        if (existing) {
          const stored = existing.post;
          const scheduled = parseAbsolute(
            stored.scheduledAt,
            session.user.timeZone,
          );
          const ids = stored.deliveries.map(
            (delivery) => delivery.connectionId,
          );
          setPost(stored);
          setText(stored.text);
          const overrides = Object.fromEntries(
            stored.deliveries.flatMap((delivery) =>
              delivery.textOverride === null
                ? []
                : [[delivery.connectionId, delivery.textOverride]],
            ),
          );
          setTextOverrides(overrides);
          setSelected(ids);
          setMedia(stored.media);
          setDate(scheduled);
          setMode("schedule");
          baseline.current = draftSignature(
            stored.text,
            ids,
            stored.media,
            "schedule",
            scheduled,
            overrides,
          );
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setFailed(true);
          toast.danger(errorText(error));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [postId, draftId, session.user.timeZone, revision]);

  useEffect(() => {
    if (!mediaIds) return;
    const controller = new AbortController();
    async function loadPreviews() {
      try {
        const results = await Promise.all(
          mediaIds.split(",").map(async (id) => ({
            id,
            ...(await api<{ url: string }>(
              `/media/${id}/preview`,
              undefined,
              "GET",
              { signal: controller.signal },
            )),
          })),
        );
        if (!controller.signal.aborted)
          setMedia((current) =>
            current.map((image) => ({
              ...image,
              url:
                results.find((result) => result.id === image.id)?.url ??
                image.url,
            })),
          );
      } catch (error) {
        if (!controller.signal.aborted) toast.danger(errorText(error));
      }
    }
    void loadPreviews();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void loadPreviews();
    }, 600_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [mediaIds]);

  useEffect(() => {
    function protectNavigation(event: Event) {
      if (uploading) {
        event.preventDefault();
        toast.warning(
          "Wait for your media to finish preparing before leaving.",
        );
        return;
      }
      if (skipGuard.current || (!dirty && !ambiguous)) return;
      event.preventDefault();
      setLeave((event as CustomEvent<NavigationRequest>).detail);
    }
    function protectReload(event: BeforeUnloadEvent) {
      if (!skipGuard.current && (dirty || ambiguous || uploading))
        event.preventDefault();
    }
    window.addEventListener("posted:before-navigate", protectNavigation);
    window.addEventListener("beforeunload", protectReload);
    return () => {
      window.removeEventListener("posted:before-navigate", protectNavigation);
      window.removeEventListener("beforeunload", protectReload);
    };
  }, [dirty, ambiguous, uploading]);

  async function upload(file: File) {
    if (!file.type.startsWith("video/") && file.size > 20 * 1024 * 1024)
      throw new Error("Images must be 20 MB or smaller.");
    if (locked || uploading || media.length >= 20)
      throw new Error(
        "Wait for the current upload or remove a file before adding another.",
      );
    setUploading(true);
    try {
      const signed = await api<{
        mediaId: string;
        uploadUrl: string;
        headers: Record<string, string>;
      }>("/media/uploads", {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        alt,
      });
      const response = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: signed.headers,
        body: file,
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok)
        throw new Error(
          "The media could not be uploaded. Check your storage configuration and try again.",
        );
      type Completion = { state: string; media?: PostMedia };
      let result = await api<Completion>(
        `/media/${signed.mediaId}/complete`,
        {},
      );
      if (result.state === "processing")
        toast.info("Video uploaded. Preparing it for your post…");
      const processing = AbortSignal.timeout(1_020_000);
      while (result.state === "processing") {
        await new Promise<void>((resolve) => setTimeout(resolve, 2000));
        processing.throwIfAborted();
        result = await api<Completion>(
          `/media/${signed.mediaId}/status`,
          undefined,
          "GET",
          { signal: processing },
        );
      }
      if (!result.media)
        throw new Error("The media response was incomplete. Try again.");
      const added = result.media;
      setMedia((current) => [...current, added]);
      setAlt("");
      toast.success("Media added to your post");
    } finally {
      setUploading(false);
    }
  }

  async function saveDraft() {
    if (!canEdit || busy || uploading || (ambiguous && !draftRetry)) return;
    draftSave.current ??= {
      id: draftId ?? crypto.randomUUID(),
      input: {
        text,
        textOverrides: Object.fromEntries(
          selected
            .filter((id) => textOverrides[id] !== undefined)
            .map((id) => [id, textOverrides[id]]),
        ),
        connectionIds: selected,
        mediaIds: media.map((image) => image.id),
        version: savedDraft?.version ?? 0,
        idempotencyKey: crypto.randomUUID(),
      },
    };
    setBusy(true);
    try {
      await api(`/drafts/${draftSave.current.id}`, draftSave.current.input);
      skipGuard.current = true;
      onSubmitted();
      toast.success("Draft saved");
      navigate("/posts/drafts");
    } catch (error) {
      const unknown =
        !(error instanceof ApiError) ||
        error.status === 0 ||
        error.status >= 500;
      setAmbiguous(unknown);
      setDraftRetry(unknown);
      if (!unknown) draftSave.current = null;
      toast.danger(
        unknown
          ? "The draft save response was lost. Retry safely before changing its content."
          : errorText(error),
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(publishMode = mode, publishDate = date) {
    if (!canEdit || !editablePost || busy || uploading) return;
    if (!retry.current) {
      const invalid = chosen.find((account) => accountErrors[account.id]);
      if (invalid) {
        setPreviewId(invalid.id);
        accountText.current?.focus();
        return;
      }
      if (!selected.length) {
        toast.warning("Add text or media and choose at least one account");
        return;
      }
      if (
        publishMode === "schedule" &&
        publishDate.toDate().getTime() <= Date.now()
      ) {
        toast.warning("Choose a future date and time");
        return;
      }
      retry.current = {
        text,
        textOverrides: Object.fromEntries(
          selected
            .filter((id) => textOverrides[id] !== undefined)
            .map((id) => [id, textOverrides[id]]),
        ),
        connectionIds: selected,
        mediaIds: media.map((image) => image.id),
        scheduledAt:
          publishMode === "schedule"
            ? publishDate.toDate().toISOString()
            : new Date().toISOString(),
        idempotencyKey: key.current,
        ...(savedDraft
          ? { draftSource: { id: savedDraft.id, version: savedDraft.version } }
          : {}),
      };
      setMode(publishMode);
      setDate(publishDate);
    }
    setBusy(true);
    try {
      const payload = retry.current;
      const result = await api<{ post: Post }>(
        postId ? `/posts/${postId}` : "/posts",
        postId ? { ...payload, version: post?.version } : payload,
        postId ? "PATCH" : "POST",
      );
      skipGuard.current = true;
      setScheduleOpen(false);
      setPostNowOpen(false);
      onSubmitted();
      toast.success(
        postId
          ? "Scheduled post updated"
          : publishMode === "schedule"
            ? "Post scheduled"
            : "Post queued for publishing",
      );
      navigate(
        postId || publishMode === "schedule"
          ? "/posts/scheduled"
          : `/posts/${result.post.id}`,
      );
    } catch (error) {
      const unknownOutcome =
        !(error instanceof ApiError) ||
        error.status === 0 ||
        error.status >= 500;
      setAmbiguous(unknownOutcome);
      if (!unknownOutcome) retry.current = null;
      toast.danger(
        unknownOutcome
          ? "The save response was lost. Retry this request safely before changing its content."
          : errorText(error),
      );
    } finally {
      setBusy(false);
    }
  }

  const previewMedia: PreviewMedia[] = media.flatMap((image) =>
    image.url ? [{ ...image, url: image.url }] : [],
  );
  const publishDisabled =
    !canEdit ||
    !editablePost ||
    busy ||
    uploading ||
    draftRetry ||
    hasAccountErrors ||
    !selected.length;
  function requestPublish() {
    if (publishDisabled) return;
    if (ambiguous || postId) void submit(ambiguous ? mode : "schedule");
    else setPostNowOpen(true);
  }
  const publishAction = (
    <ButtonGroup
      size="sm"
      className="items-stretch"
      isDisabled={publishDisabled}
      aria-label="Publishing actions"
    >
      <Button
        size="sm"
        isPending={busy && !draftSave.current}
        isDisabled={publishDisabled}
        onPress={requestPublish}
      >
        <HugeiconsIcon
          icon={postId ? Calendar03Icon : SentIcon}
          size={16}
          aria-hidden
        />
        {ambiguous && !draftRetry
          ? "Retry save safely"
          : postId
            ? "Save changes"
            : "Post now"}
      </Button>
      <Dropdown>
        <Button
          isIconOnly
          size="sm"
          className="h-auto self-stretch"
          aria-label="More publishing options"
          isDisabled={publishDisabled || ambiguous}
        >
          <ButtonGroup.Separator />
          <HugeiconsIcon icon={ArrowDown01Icon} size={16} aria-hidden />
        </Button>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu
            aria-label="Publishing options"
            disabledKeys={publishDisabled || ambiguous ? ["schedule"] : []}
            onAction={() => {
              setScheduleDate(
                date.toDate().getTime() > Date.now()
                  ? date
                  : now(session.user.timeZone)
                      .add({ hours: 1 })
                      .set({ second: 0, millisecond: 0 }),
              );
              setScheduleOpen(true);
            }}
          >
            <Dropdown.Item
              id="schedule"
              textValue={postId ? "Save & Update Schedule" : "Schedule"}
            >
              <HugeiconsIcon icon={Calendar03Icon} size={16} aria-hidden />
              <Label>{postId ? "Save & Update Schedule" : "Schedule"}</Label>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </ButtonGroup>
  );
  if (loading)
    return (
      <p className="py-10 text-sm text-muted" role="status">
        Loading editor…
      </p>
    );
  if (failed)
    return (
      <Button
        variant="secondary"
        onPress={() => setRevision((value) => value + 1)}
      >
        Retry editor
      </Button>
    );
  return (
    <section className="min-w-0">
      <PageHeading
        title={
          postId ? "Edit Schedule" : draftId ? "Edit Draft" : "Create post"
        }
        icon={<HugeiconsIcon icon={Edit02Icon} />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!postId && (
              <Button
                size="sm"
                variant="secondary"
                isPending={busy && !!draftSave.current}
                isDisabled={
                  !canEdit || busy || uploading || (ambiguous && !draftRetry)
                }
                onPress={() => void saveDraft()}
              >
                <HugeiconsIcon icon={FloppyDiskIcon} size={16} aria-hidden />
                {draftRetry ? "Retry draft save" : "Save as draft"}
              </Button>
            )}
            {publishAction}
          </div>
        }
      />
      {!editablePost && (
        <p className="mb-6 text-sm text-muted">
          This post has started publishing. Its content can no longer be edited.
        </p>
      )}
      <div className="min-w-0">
        <form
          id="post-composer"
          className="grid min-w-0 content-start items-start gap-7 lg:grid-cols-2 lg:gap-x-6"
          onSubmit={(event) => {
            event.preventDefault();
            requestPublish();
          }}
        >
          <section
            className="grid min-w-0 content-start gap-4"
            aria-label="Post content"
          >
            <Card className="min-w-0">
              <Card.Content className="grid min-w-0 gap-4">
                <TextField
                  label="Master text"
                  hideLabel
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  multiline
                  rows={12}
                  maxLength={3000}
                  disabled={locked}
                  variant="secondary"
                  placeholder="What do you want to share?"
                  className="min-h-72 resize-y p-5 text-base leading-relaxed"
                />
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
                      onChange={setMedia}
                    />
                  </Suspense>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="secondary"
                    onPress={() => setUploadOpen(true)}
                    isDisabled={
                      locked ||
                      uploading ||
                      !configuration?.enabled ||
                      media.length >= 20
                    }
                  >
                    <HugeiconsIcon
                      icon={AttachmentIcon}
                      size={16}
                      aria-hidden
                    />
                    Add media
                  </Button>
                  {!configuration?.enabled && (
                    <p className="text-xs text-muted">
                      Media storage hasn't been configured.
                    </p>
                  )}
                </div>
              </Card.Content>
            </Card>
          </section>
          <Card className="min-w-0">
            <Card.Content
              className={`grid min-w-0 content-start ${preview ? "gap-4" : "gap-3"}`}
            >
              <ComposerAccounts
                accounts={accounts}
                selected={selected}
                activeId={preview?.id}
                locked={locked}
                errors={accountErrors}
                onChange={setSelected}
                onActiveChange={setPreviewId}
              />
              {preview ? (
                <div className="grid min-w-0 gap-6">
                  <section
                    className="grid min-w-0 content-start gap-3"
                    aria-label="Account content"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-base font-medium">
                          {preview.name}
                        </h2>
                        <p className="text-xs text-muted">
                          {providerNames[preview.provider]} · @{preview.handle}
                        </p>
                      </div>
                      {textOverrides[preview.id] !== undefined && (
                        <Button
                          variant="tertiary"
                          isDisabled={locked}
                          onPress={() => {
                            setTextOverrides((current) => {
                              const next = { ...current };
                              delete next[preview.id];
                              return next;
                            });
                            accountText.current?.focus();
                          }}
                        >
                          Use master text
                        </Button>
                      )}
                    </div>
                    <TextField
                      ref={accountText}
                      label="Account text"
                      hideLabel
                      multiline
                      value={textOverrides[preview.id] ?? text}
                      onChange={(event) =>
                        setTextOverrides((current) => ({
                          ...current,
                          [preview.id]: event.target.value,
                        }))
                      }
                      maxLength={3000}
                      disabled={locked}
                      aria-invalid={
                        invalidAccounts.includes(preview) ||
                        (!(textOverrides[preview.id] ?? text).trim() &&
                          !media.length)
                      }
                      variant="secondary"
                      rows={3}
                      className="min-h-24 resize-y p-4 text-base leading-relaxed"
                    />
                    <p
                      className={`text-xs tabular-nums ${invalidAccounts.includes(preview) ? "text-danger" : "text-muted"}`}
                    >
                      {providerTextLength(
                        preview.provider,
                        textOverrides[preview.id] ?? text,
                      )}
                      /{characterLimits[preview.provider]} characters
                    </p>
                  </section>
                  <aside
                    className="grid min-w-0 content-start gap-3"
                    aria-label="Live preview"
                  >
                    <h2 className="text-base font-medium">Live preview</h2>
                    <SocialPreview
                      account={preview}
                      text={textOverrides[preview.id] ?? text}
                      media={mediaForProvider(preview.provider, previewMedia)}
                    />
                  </aside>
                </div>
              ) : (
                <p className="text-sm text-muted">
                  Choose accounts to customise their content and see a live
                  preview.
                </p>
              )}
            </Card.Content>
          </Card>
        </form>
      </div>
      <Dialog
        open={postNowOpen}
        onClose={() => setPostNowOpen(false)}
        title="Post now?"
        isDismissDisabled={busy}
        footer={
          <>
            <Button
              variant="secondary"
              onPress={() => setPostNowOpen(false)}
              isDisabled={busy}
            >
              Cancel
            </Button>
            <Button
              isPending={busy}
              isDisabled={publishDisabled}
              onPress={() => void submit("now")}
            >
              <HugeiconsIcon icon={SentIcon} size={16} aria-hidden />
              {ambiguous ? "Retry save safely" : "Post now"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Publish this post to the selected accounts now?
        </p>
      </Dialog>
      <Dialog
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        title={postId ? "Update schedule" : "Schedule post"}
        isDismissDisabled={busy}
        footer={
          <>
            <Button
              variant="secondary"
              onPress={() => setScheduleOpen(false)}
              isDisabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="post-schedule"
              isPending={busy}
              isDisabled={publishDisabled || !scheduleDate}
            >
              <HugeiconsIcon icon={Calendar03Icon} size={16} aria-hidden />
              {ambiguous
                ? "Retry save safely"
                : postId
                  ? "Save & Update Schedule"
                  : "Schedule post"}
            </Button>
          </>
        }
      >
        <form
          id="post-schedule"
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (scheduleDate) void submit("schedule", scheduleDate);
          }}
        >
          <DatePicker
            value={scheduleDate}
            onChange={(value) => {
              setScheduleDate(value);
            }}
            name="scheduledAt"
            isRequired
            granularity="minute"
            hideTimeZone
            isDisabled={locked}
            minValue={now(session.user.timeZone)}
            hourCycle={session.user.timeFormat.startsWith("12") ? 12 : 24}
          >
            <Label>Scheduled for</Label>
            <DateField.Group variant="secondary" fullWidth>
              <DateField.Input>
                {(segment) => <DateField.Segment segment={segment} />}
              </DateField.Input>
              <DateField.Suffix>
                <DatePicker.Trigger aria-label="Choose publishing date">
                  <DatePicker.TriggerIndicator />
                </DatePicker.Trigger>
              </DateField.Suffix>
            </DateField.Group>
            <FieldError />
            <DatePicker.Popover>
              <Calendar
                aria-label="Publishing date"
                minValue={now(session.user.timeZone)}
              >
                <Calendar.Header>
                  <Calendar.YearPickerTrigger>
                    <Calendar.YearPickerTriggerHeading />
                    <Calendar.YearPickerTriggerIndicator />
                  </Calendar.YearPickerTrigger>
                  <Calendar.NavButton slot="previous" />
                  <Calendar.NavButton slot="next" />
                </Calendar.Header>
                <Calendar.Grid>
                  <Calendar.GridHeader>
                    {(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}
                  </Calendar.GridHeader>
                  <Calendar.GridBody>
                    {(value) => <Calendar.Cell date={value} />}
                  </Calendar.GridBody>
                </Calendar.Grid>
                <Calendar.YearPickerGrid>
                  <Calendar.YearPickerGridBody>
                    {({ year }) => <Calendar.YearPickerCell year={year} />}
                  </Calendar.YearPickerGridBody>
                </Calendar.YearPickerGrid>
              </Calendar>
            </DatePicker.Popover>
          </DatePicker>
          <p className="text-xs text-muted">
            Times are shown in {session.user.timeZone}.
          </p>
        </form>
      </Dialog>
      <Dialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Add media"
        isDismissDisabled={uploading}
        footer={
          <Button
            variant="secondary"
            onPress={() => setUploadOpen(false)}
            isDisabled={uploading}
          >
            Done
          </Button>
        }
      >
        <div className="grid gap-4">
          <TextField
            label="Media description"
            value={alt}
            onChange={(event) => setAlt(event.target.value)}
            disabled={uploading}
            maxLength={2000}
            multiline
            description="Describe the next file for people using screen readers."
          />
          <FileUpload
            label="Upload media"
            description="Drop an image or video here or browse your files."
            accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
            maxSizeBytes={configuration?.maxBytes ?? videoUploadBytes}
            isDisabled={locked || uploading || media.length >= 20}
            onUpload={upload}
          />
          <p className="text-xs text-muted">
            {media.length} of 20 files added.
          </p>
        </div>
      </Dialog>
      <Dialog
        open={!!leave}
        onClose={() => setLeave(null)}
        title={
          ambiguous
            ? "Leave before confirming this save?"
            : "Discard this draft?"
        }
        footer={
          <>
            <Button variant="secondary" onPress={() => setLeave(null)}>
              Keep editing
            </Button>
            <Button
              variant="danger-soft"
              onPress={() => {
                skipGuard.current = true;
                leave?.resume();
                setLeave(null);
              }}
            >
              Leave editor
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-muted">
          {ambiguous
            ? "This request may already be saved. Check your schedule before creating another copy."
            : "Your unsaved changes will be lost. Scheduled posts are unchanged."}
        </p>
      </Dialog>
    </section>
  );
}
