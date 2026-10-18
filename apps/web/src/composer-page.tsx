import {
  characterLimits,
  providerTextLength,
} from "../../../packages/contracts/src/text.js";
import {
  mediaForProvider,
  mediaError,
  videoUploadBytes,
} from "../../../packages/contracts/src/media.js";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
  TimeField,
} from "@heroui/react";
import {
  Button,
  Dialog,
  Dropdown,
  FileUpload,
  TextField,
  toast,
  Tabs,
  Tooltip,
} from "@posted/web-design-system";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Calendar03Icon,
  ArrowDown01Icon,
  QuillWrite01Icon,
  QuillWrite02Icon,
  SentIcon,
  FloppyDiskIcon,
  Add01Icon,
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
import { providerNames, SocialSequencePreview } from "./social-ui.js";

import { ComposerAccounts } from "./composer-accounts.js";
import type { ComposerMediaItem } from "./composer-media.js";
import { MasterPostEditor, type ComposerPart } from "./composer-post.js";
import { GridList, GridListItem, useDragAndDrop } from "react-aria-components";
import { reorderItems } from "./item-order.js";
import { ComposerAccountEditor } from "./composer-account-editor.js";
import { PublishingSummary } from "./publishing-summary.js";

type MediaConfiguration = {
  enabled: boolean;
  maxBytes: number;
  contentTypes: string[];
};
type PostEditAction =
  | { kind: "remove"; partId: string }
  | { kind: "reset"; partId: string; accountId: string };
const desktopQuery = "(min-width: 1024px)";
function subscribeDesktop(onChange: () => void) {
  const query = window.matchMedia(desktopQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
function desktopSnapshot() {
  return window.matchMedia(desktopQuery).matches;
}

function draftSignature(
  text: string,
  accounts: string[],
  media: ComposerMediaItem[],
  mode: string,
  date: ZonedDateTime,
  textOverrides: Record<string, string> = {},
  additionalPosts: ComposerPart[] = [],
  mediaOverrides: Record<string, ComposerMediaItem[]> = {},
) {
  return JSON.stringify({
    text,
    additionalPosts: additionalPosts.map((part) => ({
      text: part.text,
      media: part.media.map((image) => image.id),
      mediaOverrides: mediaOverrideInput(part.mediaOverrides, accounts),
      textOverrides: Object.fromEntries(
        accounts
          .filter((id) => part.textOverrides[id] !== undefined)
          .sort()
          .map((id) => [id, part.textOverrides[id]]),
      ),
    })),
    textOverrides: Object.fromEntries(
      accounts
        .filter((id) => textOverrides[id] !== undefined)
        .sort()
        .map((id) => [id, textOverrides[id]]),
    ),
    mediaOverrides: mediaOverrideInput(mediaOverrides, accounts),
    accounts: [...accounts].sort(),
    media: media.map((image) => image.id),
    mode,
    date: mode === "schedule" ? date.toDate().toISOString() : null,
  });
}

function mediaOverrideInput(
  overrides: Record<string, ComposerMediaItem[]>,
  selected: string[],
) {
  return Object.fromEntries(
    selected
      .filter((id) => overrides[id] !== undefined)
      .sort()
      .map((id) => [id, overrides[id].map((item) => item.id)]),
  );
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
  const [parts, setParts] = useState<ComposerPart[]>(() => [
    {
      id: crypto.randomUUID(),
      text: initialText,
      textOverrides: {},
      media: [],
      mediaOverrides: {},
    },
  ]);
  const [accounts, setAccounts] = useState<SocialConnection[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [{ text, textOverrides, media, mediaOverrides }, ...additionalPosts] =
    parts;
  const [activePostId, setActivePostId] = useState<string | null>(parts[0].id);
  const [uploadTarget, setUploadTarget] = useState<{
    partId: string;
    accountId?: string;
  } | null>(null);
  const [mobileView, setMobileView] = useState("write");
  const desktop = useSyncExternalStore(
    subscribeDesktop,
    desktopSnapshot,
    () => false,
  );
  const [focusNewPostId, setFocusNewPostId] = useState<string | null>(null);
  const postDragHandlePressed = useRef(false);
  const accountEditors = useRef(new Map<string, HTMLTextAreaElement>());
  const [accountView, setAccountView] = useState("preview");
  const [pendingPostAction, setPendingPostAction] =
    useState<PostEditAction | null>(null);
  const pendingPartIndex = parts.findIndex(
    (part) => part.id === pendingPostAction?.partId,
  );
  const resetAccount =
    pendingPostAction?.kind === "reset"
      ? accounts.find((account) => account.id === pendingPostAction.accountId)
      : undefined;
  const updatePart = useCallback(
    (id: string, change: Partial<ComposerPart>) => {
      setParts((current) =>
        current.map((part) => (part.id === id ? { ...part, ...change } : part)),
      );
    },
    [],
  );
  function applyAccountSelection(ids: string[]) {
    if (locked) return;
    const removed = new Set(selected.filter((id) => !ids.includes(id)));
    setSelected(ids);
    if (removed.size) {
      setParts((current) =>
        current.map((part) => ({
          ...part,
          mediaOverrides: Object.fromEntries(
            Object.entries(part.mediaOverrides).filter(
              ([id]) => !removed.has(id),
            ),
          ),
          textOverrides: Object.fromEntries(
            Object.entries(part.textOverrides).filter(
              ([id]) => !removed.has(id),
            ),
          ),
        })),
      );
    }
    if (!ids.includes(previewId)) setPreviewId(ids[0] ?? "");
  }
  function removePart(index: number) {
    if (parts.length === 1) return;
    const next = parts.filter((_, at) => at !== index);
    setParts(next);
    if (parts[index].id === activePostId)
      setActivePostId(next[Math.min(index, next.length - 1)].id);
  }
  function confirmPostAction() {
    if (!pendingPostAction || locked || uploading || pendingPartIndex < 0)
      return;
    if (pendingPostAction.kind === "remove") removePart(pendingPartIndex);
    else {
      const next = { ...parts[pendingPartIndex].textOverrides };
      delete next[pendingPostAction.accountId];
      const nextMedia = { ...parts[pendingPartIndex].mediaOverrides };
      delete nextMedia[pendingPostAction.accountId];
      updatePart(parts[pendingPartIndex].id, {
        textOverrides: next,
        mediaOverrides: nextMedia,
      });
      const partId = pendingPostAction.partId;
      requestAnimationFrame(() => accountEditors.current.get(partId)?.focus());
    }
    setPendingPostAction(null);
  }
  function insertPart(index: number) {
    const part: ComposerPart = {
      id: crypto.randomUUID(),
      text: "",
      textOverrides: {},
      media: [],
      mediaOverrides: {},
    };
    setParts((current) => [
      ...current.slice(0, index),
      part,
      ...current.slice(index),
    ]);
    setActivePostId(part.id);
    setFocusNewPostId(part.id);
    setMobileView("write");
  }
  function activatePart(id: string | null) {
    setActivePostId(id);
  }
  function movePart(index: number, direction: -1 | 1) {
    const target = parts[index + direction];
    if (!target) return;
    setParts((current) =>
      reorderItems(
        current,
        new Set([parts[index].id]),
        target.id,
        direction === -1 ? "before" : "after",
      ),
    );
    toast.success(`Post moved to position ${index + direction + 1}`);
  }
  function additionalInput() {
    return additionalPosts.map((part) => ({
      text: part.text,
      textOverrides: Object.fromEntries(
        selected
          .filter((id) => part.textOverrides[id] !== undefined)
          .map((id) => [id, part.textOverrides[id]]),
      ),
      mediaIds: part.media.map((image) => image.id),
      mediaOverrides: mediaOverrideInput(part.mediaOverrides, selected),
    }));
  }
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
  const previewUrls = useRef(
    new Map<string, { url: string; expiresAt: number }>(),
  );
  const key = useRef<string>(crypto.randomUUID());
  const retry = useRef<PostInput | null>(null);
  const draftSave = useRef<{ id: string; input: DraftInput } | null>(null);
  const skipGuard = useRef(false);
  const baseline = useRef(
    draftSignature(initialText, [], [], postId ? "schedule" : "now", date),
  );
  const dirty =
    draftSignature(
      text,
      selected,
      media,
      mode,
      date,
      textOverrides,
      additionalPosts,
      mediaOverrides,
    ) !== baseline.current;
  const editablePost =
    !postId ||
    (!!post &&
      post.deliveries.every((delivery) => delivery.state === "scheduled"));
  const locked = !canEdit || !editablePost || busy || ambiguous;
  const chosen = accounts.filter((account) => selected.includes(account.id));
  function partError(account: SocialConnection, part: ComposerPart) {
    const value = part.textOverrides[account.id] ?? part.text;
    const accountMedia = part.mediaOverrides[account.id] ?? part.media;
    return providerTextLength(account.provider, value) >
      characterLimits[account.provider]
      ? `${providerNames[account.provider]} supports up to ${characterLimits[account.provider]} characters.`
      : !value.trim() && !accountMedia.length
        ? "Add text or media for this account."
        : mediaError(account.provider, accountMedia);
  }
  const accountErrors: Record<string, string> = Object.fromEntries(
    chosen.flatMap((account) => {
      if (account.state !== "connected")
        return [[account.id, "Reconnect this account before posting."]];
      const index = parts.findIndex((part) => partError(account, part));
      return index < 0
        ? []
        : [
            [
              account.id,
              `Post ${index + 1}: ${partError(account, parts[index])}`,
            ],
          ];
    }),
  );
  const hasAccountErrors = Object.keys(accountErrors).length > 0;
  const preview =
    chosen.find((account) => account.id === previewId) ?? chosen[0];
  const mediaIds = [
    ...new Set(
      parts.flatMap((part) =>
        [...part.media, ...Object.values(part.mediaOverrides).flat()].map(
          (image) => image.id,
        ),
      ),
    ),
  ]
    .sort()
    .join(",");
  const uploadPostIndex = parts.findIndex(
    (part) => part.id === uploadTarget?.partId,
  );
  const uploadPart = parts[uploadPostIndex];
  const uploadMedia = uploadPart
    ? uploadTarget?.accountId
      ? (uploadPart.mediaOverrides[uploadTarget.accountId] ?? uploadPart.media)
      : uploadPart.media
    : [];

  const { dragAndDropHooks } = useDragAndDrop<ComposerPart>({
    isDisabled: locked || uploading || parts.length < 2,
    getItems: (_keys, items) =>
      items.map((part) => ({ "application/x-posted-post": part.id })),
    onReorder: ({ keys, target }) => {
      if (target.dropPosition === "before" || target.dropPosition === "after") {
        const position = target.dropPosition;
        setParts((current) =>
          reorderItems(current, keys, target.key, position),
        );
        toast.success("Post order updated");
      }
    },
  });

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

          setSelected(stored.connectionIds);

          const loadedParts = [
            {
              id: crypto.randomUUID(),
              text: stored.text,
              textOverrides: stored.textOverrides,
              media: stored.media,
              mediaOverrides: stored.mediaOverrides,
            },
            ...stored.additionalPosts.map((part) => ({
              ...part,
              id: crypto.randomUUID(),
            })),
          ];
          setParts(loadedParts);
          setActivePostId(loadedParts[0].id);
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
            stored.additionalPosts.map((part) => ({
              ...part,
              id: crypto.randomUUID(),
            })),
            stored.mediaOverrides,
          );
        }
        if (existing) {
          const stored = existing.post;
          const scheduled = parseAbsolute(
            stored.scheduledAt,
            session.user.timeZone,
          );
          const ids = [
            ...new Set(
              stored.deliveries.map((delivery) => delivery.connectionId),
            ),
          ];
          setPost(stored);

          const overrides = Object.fromEntries(
            stored.deliveries
              .filter((delivery) => delivery.postIndex === 0)
              .flatMap((delivery) =>
                delivery.textOverride === null
                  ? []
                  : [[delivery.connectionId, delivery.textOverride]],
              ),
          );

          setSelected(ids);

          const loadedParts = [
            {
              id: crypto.randomUUID(),
              text: stored.text,
              textOverrides: overrides,
              media: stored.media,
              mediaOverrides: stored.mediaOverrides,
            },
            ...stored.additionalPosts.map((part) => ({
              ...part,
              id: crypto.randomUUID(),
            })),
          ];
          setParts(loadedParts);
          setActivePostId(loadedParts[0].id);
          setDate(scheduled);
          setMode("schedule");
          baseline.current = draftSignature(
            stored.text,
            ids,
            stored.media,
            "schedule",
            scheduled,
            overrides,
            stored.additionalPosts.map((part) => ({
              ...part,
              id: crypto.randomUUID(),
            })),
            stored.mediaOverrides,
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
    const ids = mediaIds.split(",");
    let running = false;
    async function loadPreviews() {
      if (running) return;
      running = true;
      try {
        let next = 0;
        await Promise.all(
          Array.from({ length: Math.min(4, ids.length) }, async () => {
            while (next < ids.length) {
              const id = ids[next++];
              const cached = previewUrls.current.get(id);
              if (cached && cached.expiresAt > Date.now()) continue;
              const { url } = await api<{ url: string }>(
                `/media/${id}/preview`,
                undefined,
                "GET",
                { signal: controller.signal },
              );
              if (!controller.signal.aborted)
                previewUrls.current.set(id, {
                  url,
                  expiresAt: Date.now() + 540_000,
                });
            }
          }),
        );
        if (!controller.signal.aborted) {
          const refresh = (items: ComposerMediaItem[]) => {
            let changed = false;
            const result = items.map((image) => {
              const url = previewUrls.current.get(image.id)?.url;
              if (!url || url === image.url) return image;
              changed = true;
              return { ...image, url };
            });
            return changed ? result : items;
          };
          setParts((current) =>
            current.map((part) => {
              const media = refresh(part.media);
              const entries = Object.entries(part.mediaOverrides).map(
                ([id, items]) => [id, refresh(items)] as const,
              );
              const changed = entries.some(
                ([id, items]) => items !== part.mediaOverrides[id],
              );
              return media === part.media && !changed
                ? part
                : {
                    ...part,
                    media,
                    mediaOverrides: Object.fromEntries(entries),
                  };
            }),
          );
        }
      } catch (error) {
        if (!controller.signal.aborted) toast.danger(errorText(error));
      } finally {
        running = false;
      }
    }
    void loadPreviews();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void loadPreviews();
    }, 60_000);
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
    if (!uploadPart || locked || uploading || uploadMedia.length >= 20)
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
      setParts((current) =>
        current.map((part) => {
          if (part.id !== uploadTarget?.partId) return part;
          if (uploadTarget.accountId) {
            const items =
              part.mediaOverrides[uploadTarget.accountId] ?? part.media;
            return {
              ...part,
              mediaOverrides: {
                ...part.mediaOverrides,
                [uploadTarget.accountId]: [...items, added],
              },
            };
          }
          return { ...part, media: [...part.media, added] };
        }),
      );
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
        mediaOverrides: mediaOverrideInput(mediaOverrides, selected),
        additionalPosts: additionalInput(),
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
        mediaOverrides: mediaOverrideInput(mediaOverrides, selected),
        additionalPosts: additionalInput(),
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
  const publishLabel =
    desktop && selected.length
      ? `Post in ${selected.length} ${selected.length === 1 ? "account" : "accounts"}`
      : "Post now";
  const publishAction = (
    <ButtonGroup
      size="md"
      className="items-stretch"
      isDisabled={publishDisabled}
      aria-label="Publishing actions"
    >
      <Button
        size="md"
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
            : publishLabel}
      </Button>
      <Dropdown>
        <Button
          isIconOnly
          size="md"
          className="self-stretch"
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
              textValue={
                postId ? "Save & Update Schedule" : "Schedule for later"
              }
            >
              <HugeiconsIcon icon={Calendar03Icon} size={16} aria-hidden />
              <Label>
                {postId ? "Save & Update Schedule" : "Schedule for later"}
              </Label>
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
  const writePanel = (
    <section
      className="grid min-w-0 content-start gap-3"
      aria-label="Post content"
      onPointerDownCapture={(event) => {
        postDragHandlePressed.current =
          event.target instanceof Element &&
          !!event.target.closest("[data-post-drag-handle]");
      }}
      onDragStartCapture={(event) => {
        if (
          event.target instanceof Element &&
          event.target.matches(".composer-post") &&
          !postDragHandlePressed.current
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <GridList
        aria-label="Master posts"
        items={parts}
        selectionMode="none"
        dependencies={[
          parts,
          activePostId,
          focusNewPostId,
          locked,
          uploading,
          configuration?.enabled,
          parts.length,
        ]}
        dragAndDropHooks={dragAndDropHooks}
        className="composer-posts grid min-w-0"
      >
        {(part) => {
          const index = parts.findIndex((item) => item.id === part.id);
          const expanded = parts.length === 1 || part.id === activePostId;
          return (
            <GridListItem
              id={part.id}
              textValue={`Post ${index + 1}: ${part.text.trim() || "No text yet"}`}
              className="composer-post group relative min-w-0 rounded-2xl outline-none data-[dragging]:opacity-50"
            >
              <MasterPostEditor
                part={part}
                index={index}
                total={parts.length}
                expanded={expanded}
                autoFocus={focusNewPostId === part.id}
                onFocus={() => setFocusNewPostId(null)}
                locked={locked}
                uploading={uploading}
                storageEnabled={!!configuration?.enabled}
                onActivate={() => activatePart(expanded ? null : part.id)}
                onChange={updatePart}
                onUpload={() => {
                  setUploadTarget({ partId: part.id });
                  setAlt("");
                  setUploadOpen(true);
                }}
                onRemove={() =>
                  setPendingPostAction({ kind: "remove", partId: part.id })
                }
                onInsert={() => insertPart(index + 1)}
                onMove={(direction) => movePart(index, direction)}
              />
              {index < parts.length - 1 && (
                <div className="flex items-center gap-2 px-4 py-3">
                  <span
                    aria-hidden="true"
                    className="flex-1 border-t border-dashed border-muted/30"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    isDisabled={locked || uploading}
                    aria-label={`Insert post after post ${index + 1}`}
                    onPress={() => insertPart(index + 1)}
                  >
                    <HugeiconsIcon icon={Add01Icon} size={14} aria-hidden />
                    Insert post
                  </Button>
                  <span
                    aria-hidden="true"
                    className="flex-1 border-t border-dashed border-muted/30"
                  />
                </div>
              )}
            </GridListItem>
          );
        }}
      </GridList>
      <div className="pt-3">
        <Button
          variant="secondary"
          isDisabled={locked || uploading}
          onPress={() => insertPart(parts.length)}
        >
          <HugeiconsIcon icon={Add01Icon} size={16} aria-hidden />
          Add Another Post
        </Button>
      </div>
    </section>
  );
  const editors = preview && (
    <ol className="grid min-w-0 gap-6" aria-label="Account content">
      {parts.map((part, index) => (
        <ComposerAccountEditor
          key={part.id}
          part={part}
          index={index}
          total={parts.length}
          account={preview}
          locked={locked}
          uploading={uploading}
          storageEnabled={!!configuration?.enabled}
          onUpload={() => {
            setUploadTarget({ partId: part.id, accountId: preview.id });
            setAlt("");
            setUploadOpen(true);
          }}
          error={partError(preview, part) ?? ""}
          onReset={() =>
            setPendingPostAction({
              kind: "reset",
              partId: part.id,
              accountId: preview.id,
            })
          }
          onChange={updatePart}
          inputRef={(node) => {
            if (node) accountEditors.current.set(part.id, node);
            else accountEditors.current.delete(part.id);
            if (index === 0) accountText.current = node;
          }}
        />
      ))}
    </ol>
  );
  const previews = preview && (
    <aside className="min-w-0" aria-label="Post preview">
      <SocialSequencePreview
        account={preview}
        posts={parts.map((part) => ({
          text: part.textOverrides[preview.id] ?? part.text,
          media: mediaForProvider(
            preview.provider,
            (part.mediaOverrides[preview.id] ?? part.media).flatMap((image) =>
              image.url ? [{ ...image, url: image.url }] : [],
            ),
          ),
        }))}
      />
    </aside>
  );
  function accountPanel() {
    return (
      <Card className="min-w-0">
        <Card.Content
          className={`grid min-w-0 content-start ${preview ? "gap-4" : "gap-3"}`}
        >
          <div
            className={`sticky top-0 z-10 grid min-w-0 gap-3 bg-surface ${preview ? "pb-2" : ""}`}
          >
            <ComposerAccounts
              accounts={accounts}
              selected={selected}
              activeId={preview?.id}
              locked={locked}
              errors={accountErrors}
              customAccountIds={
                new Set(
                  parts.flatMap((part) => [
                    ...Object.entries(part.textOverrides)
                      .filter(([, value]) => value.trim())
                      .map(([id]) => id),
                    ...Object.keys(part.mediaOverrides),
                  ]),
                )
              }
              onChange={applyAccountSelection}
              onActiveChange={setPreviewId}
            />
            {preview && (
              <div className="min-w-0">
                <h2 className="truncate text-base font-medium">
                  {preview.name}
                </h2>
                <p className="truncate text-xs text-muted">
                  <span className="sr-only">
                    {providerNames[preview.provider]}:{" "}
                  </span>
                  @{preview.handle}
                </p>
              </div>
            )}
          </div>
          {preview ? (
            <Tabs
              selectedKey={accountView}
              onSelectionChange={(key) => setAccountView(String(key))}
            >
              <Tabs.ListContainer>
                <Tabs.List aria-label="Account workspace">
                  <Tabs.Tab id="edit">
                    Edit
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id="preview">
                    Preview
                    <Tabs.Indicator />
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
              <Tabs.Panel id="edit" className="px-0 pt-4">
                {accountView === "edit" && editors}
              </Tabs.Panel>
              <Tabs.Panel id="preview" className="px-0 pt-4">
                {accountView === "preview" && previews}
              </Tabs.Panel>
            </Tabs>
          ) : (
            <p className="text-xs text-muted">
              Choose accounts to customise their content and see a live preview.
            </p>
          )}
        </Card.Content>
      </Card>
    );
  }
  const heading = (
    <PageHeading
      title={postId ? "Edit Schedule" : draftId ? "Edit Draft" : "Create post"}
      icon={
        <HugeiconsIcon icon={draftId ? QuillWrite02Icon : QuillWrite01Icon} />
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {!postId && (
            <Tooltip>
              <Tooltip.Trigger<"span">
                className="inline-flex shrink-0"
                role="presentation"
                tabIndex={-1}
                render={(props) => <span {...props} />}
              >
                <Button
                  isIconOnly={!desktop}
                  size="md"
                  variant="secondary"
                  aria-label={draftRetry ? "Retry draft save" : "Save as draft"}
                  isPending={busy && !!draftSave.current}
                  isDisabled={
                    !canEdit || busy || uploading || (ambiguous && !draftRetry)
                  }
                  onPress={() => void saveDraft()}
                >
                  <HugeiconsIcon icon={FloppyDiskIcon} size={16} aria-hidden />
                  {desktop &&
                    (draftRetry ? "Retry draft save" : "Save as draft")}
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>
                {draftRetry ? "Retry draft save" : "Save as draft"}
              </Tooltip.Content>
            </Tooltip>
          )}
          {publishAction}
        </div>
      }
    />
  );
  return (
    <section className="min-w-0">
      {desktop && (
        <div className="sticky top-0 z-20 bg-background pt-2">{heading}</div>
      )}
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
          {desktop ? (
            <>
              {writePanel}
              {accountPanel()}
            </>
          ) : (
            <Tabs
              selectedKey={mobileView}
              onSelectionChange={(key) => setMobileView(String(key))}
              className="min-w-0"
            >
              <div className="sticky top-0 z-20 bg-background pt-2">
                {heading}
                <Tabs.ListContainer>
                  <Tabs.List
                    aria-label="Create post workspace"
                    className="w-full"
                  >
                    <Tabs.Tab id="write" className="flex-1">
                      Write
                      <Tabs.Indicator />
                    </Tabs.Tab>
                    <Tabs.Tab id="accounts" className="flex-1">
                      Accounts
                      <Tabs.Indicator />
                    </Tabs.Tab>
                  </Tabs.List>
                </Tabs.ListContainer>
              </div>
              <Tabs.Panel id="write" className="px-0 pt-2">
                {writePanel}
              </Tabs.Panel>
              <Tabs.Panel id="accounts" className="px-0 pt-2">
                {accountPanel()}
              </Tabs.Panel>
            </Tabs>
          )}
        </form>
      </div>
      <Dialog
        open={!!pendingPostAction}
        onClose={() => setPendingPostAction(null)}
        title={
          pendingPostAction?.kind === "reset"
            ? "Reset to master?"
            : "Remove master post?"
        }
        footer={
          <>
            <Button
              autoFocus
              variant="secondary"
              onPress={() => setPendingPostAction(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              isDisabled={locked || uploading || pendingPartIndex < 0}
              onPress={confirmPostAction}
            >
              {pendingPostAction?.kind === "reset"
                ? "Reset to master"
                : "Remove post"}
            </Button>
          </>
        }
      >
        {pendingPostAction && (
          <p className="text-sm text-muted">
            {pendingPostAction.kind === "reset" ? (
              <>
                Post {pendingPartIndex + 1}
                {resetAccount &&
                  ` for ${providerNames[resetAccount.provider]} (@${resetAccount.handle})`}{" "}
                will use its master text and media again. Its custom text and
                media selection will be discarded. This cannot be undone.
              </>
            ) : (
              <>
                Remove post {pendingPartIndex + 1} from this sequence? Its text,
                attached media and account-specific edits will be lost.
                Remaining posts will be renumbered. This cannot be undone.
              </>
            )}
          </p>
        )}
      </Dialog>
      <Dialog
        open={postNowOpen}
        onClose={() => setPostNowOpen(false)}
        title="Publish now?"
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
              {ambiguous ? "Retry save safely" : publishLabel}
            </Button>
          </>
        }
      >
        <PublishingSummary accounts={chosen} postCount={parts.length} />
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
        <PublishingSummary accounts={chosen} postCount={parts.length} />
        <form
          id="post-schedule"
          className="mt-5 grid gap-3"
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
            shouldCloseOnSelect={false}
            isRequired
            granularity="minute"
            hideTimeZone
            isDisabled={locked}
            minValue={now(session.user.timeZone)}
            hourCycle={session.user.timeFormat.startsWith("12") ? 12 : 24}
          >
            {({ state }) => (
              <>
                <Label>Scheduled for</Label>
                <DateField.Group variant="secondary" fullWidth>
                  <DateField.Input>
                    {(segment) => <DateField.Segment segment={segment} />}
                  </DateField.Input>
                  <DateField.Suffix>
                    <DatePicker.Trigger aria-label="Choose publishing date and time">
                      <DatePicker.TriggerIndicator />
                    </DatePicker.Trigger>
                  </DateField.Suffix>
                </DateField.Group>
                <FieldError />
                <DatePicker.Popover className="flex flex-col gap-3">
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
                        {(day) => (
                          <Calendar.HeaderCell>{day}</Calendar.HeaderCell>
                        )}
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
                  <TimeField
                    className="flex-row items-center justify-between gap-3 border-t border-separator pt-3"
                    value={state.timeValue}
                    onChange={(value) => {
                      if (value) state.setTimeValue(value);
                    }}
                    granularity="minute"
                    hideTimeZone
                    hourCycle={
                      session.user.timeFormat.startsWith("12") ? 12 : 24
                    }
                    isDisabled={locked}
                    isRequired
                  >
                    <Label>Time</Label>
                    <TimeField.Group variant="secondary">
                      <TimeField.Input>
                        {(segment) => <TimeField.Segment segment={segment} />}
                      </TimeField.Input>
                    </TimeField.Group>
                  </TimeField>
                </DatePicker.Popover>
              </>
            )}
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
            isDisabled={locked || uploading || uploadMedia.length >= 20}
            onUpload={upload}
          />
          <p className="text-xs text-muted">
            {uploadMedia.length} of 20 files added to post {uploadPostIndex + 1}
            {uploadTarget?.accountId ? " for this account" : ""}.
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
