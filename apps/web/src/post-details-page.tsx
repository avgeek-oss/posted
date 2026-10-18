import { useState } from "react";
import {
  Attributes,
  Button,
  Chip,
  Dialog,
  Pagination,
  ResourceTable,
  TooltipText,
  toast,
} from "@posted/web-design-system";
import { HugeiconsIcon } from "@hugeicons/react";
import { SentIcon } from "@hugeicons/core-free-icons";
import type {
  Post,
  PostDelivery,
} from "../../../packages/contracts/src/index.js";
import {
  api,
  createRetryKey,
  errorText,
  hasResponseRecord,
  type Session,
} from "./api.js";
import { PageHeading } from "./page-heading.js";
import { formatDateTime } from "./date-time-preferences.js";
import { useResource } from "./use-resource.js";
import { providerNames, ProviderIcon, StateChip } from "./social-ui.js";
import { RelativeDateTime } from "./relative-date-time.js";
import { PublishingSummary } from "./publishing-summary.js";
import { supportsThreads } from "../../../packages/contracts/src/threads.js";

export function PostDetailsPage({
  postId,
  session,
}: {
  postId: string;
  session: Session;
}) {
  const [page, setPage] = useState(1);
  const [resume, setResume] = useState<{
    delivery: PostDelivery;
    version: number;
    remainingCount: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [requestKeys] = useState(createRetryKey);
  const resource = useResource<{ post: Post }>(`/posts/${postId}`, 5000);
  const post = resource.value?.post;
  const pageSize = 20;
  const totalPages = Math.max(
    1,
    Math.ceil((post?.deliveries.length ?? 0) / pageSize),
  );
  const currentPage = Math.min(page, totalPages);
  const timestamp = (value: string) => formatDateTime(value, session.user);
  async function resumePublishing() {
    if (!resume || busy) return;
    const path = `/posts/${postId}/resume`;
    const body = {
      connectionId: resume.delivery.connectionId,
      version: resume.version,
    };
    setBusy(true);
    try {
      await api(
        path,
        { ...body, idempotencyKey: requestKeys.forRequest(path, body) },
        "POST",
        { validateResponse: (value) => hasResponseRecord(value, "post") },
      );
      requestKeys.reset();
      setResume(null);
      resource.refresh();
      window.dispatchEvent(new Event("posted:posts-changed"));
      toast.success("Remaining posts queued for publishing");
    } catch (error) {
      toast.danger(errorText(error));
      resource.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="min-w-0">
      <PageHeading
        title="Delivery details"
        icon={<HugeiconsIcon icon={SentIcon} />}
        actions={post ? <StateChip state={post.state} /> : undefined}
        actionsPlacement="inline"
      />
      {resource.pending && !post ? (
        <p role="status" className="py-8 text-sm text-muted">
          Loading deliveries…
        </p>
      ) : resource.failed && !post ? (
        <Button variant="secondary" onPress={resource.refresh}>
          Retry
        </Button>
      ) : post ? (
        <div className="grid min-w-0 gap-4">
          <Attributes title="Delivery set" variant="card">
            <Attributes.Item label="Requested">
              <time dateTime={post.createdAt}>{timestamp(post.createdAt)}</time>
            </Attributes.Item>
            <Attributes.Item label="Scheduled for">
              <time dateTime={post.scheduledAt}>
                {timestamp(post.scheduledAt)}
              </time>
            </Attributes.Item>
          </Attributes>
          {post.deliveries.some(
            (delivery) => delivery.state === "uncertain",
          ) && (
            <p className="text-sm text-muted">
              Some publishing results are unconfirmed. Check those accounts
              directly. Posted will not resend those posts or resume their
              threads automatically.
            </p>
          )}
          <ResourceTable
            ariaLabel="Delivery status by account"
            mobileLayout="scroll"
            tableClassName="min-w-4xl"
            items={post.deliveries.slice(
              (currentPage - 1) * pageSize,
              currentPage * pageSize,
            )}
            getRowKey={(delivery) => delivery.id}
            emptyTitle="No deliveries"
            emptyDescription="This post has no delivery records."
            columns={[
              {
                key: "account",
                header: "Account",
                isRowHeader: true,
                className: "min-w-48",
                cell: (delivery) => (
                  <div className="flex items-center gap-2">
                    <ProviderIcon provider={delivery.provider} />
                    <span className="sr-only">
                      {providerNames[delivery.provider]}:{" "}
                    </span>
                    <TooltipText
                      tooltip={delivery.accountName}
                      className="max-w-56 line-clamp-2"
                    >
                      {delivery.accountName}
                    </TooltipText>
                  </div>
                ),
              },
              {
                key: "postIndex",
                header: "Post",
                className: "whitespace-nowrap",
                cell: (delivery) =>
                  `${delivery.postIndex + 1} of ${post.additionalPosts.length + 1}`,
              },
              {
                key: "content",
                header: "Content",
                className: "min-w-64 max-w-sm",
                cell: (delivery) => (
                  <TooltipText
                    tooltip={
                      delivery.textOverride ??
                      (delivery.postIndex === 0
                        ? post.text
                        : post.additionalPosts[delivery.postIndex - 1].text)
                    }
                    className="max-w-sm line-clamp-2 whitespace-pre-wrap break-words"
                  >
                    {(delivery.textOverride ??
                      (delivery.postIndex === 0
                        ? post.text
                        : post.additionalPosts[delivery.postIndex - 1].text)) ||
                      "Media post"}
                  </TooltipText>
                ),
              },
              {
                key: "status",
                header: "Status",
                cell: (delivery) => (
                  <div className="grid justify-items-start gap-1">
                    {delivery.nextAttemptAt ? (
                      <Chip size="sm" color="warning" variant="soft">
                        <Chip.Label>Retry scheduled</Chip.Label>
                      </Chip>
                    ) : (
                      <StateChip state={delivery.state} />
                    )}
                    {delivery.nextAttemptAt && (
                      <RelativeDateTime
                        value={delivery.nextAttemptAt}
                        timeZone={session.user.timeZone}
                        label="Next attempt"
                        compact
                        showAbsolute={false}
                      />
                    )}
                    {delivery.attempts > 0 && (
                      <span className="text-xs text-muted">
                        {delivery.attempts}{" "}
                        {delivery.attempts === 1 ? "attempt" : "attempts"}
                      </span>
                    )}
                  </div>
                ),
              },
              {
                key: "published",
                header: "Published",
                className: "whitespace-nowrap",
                cell: (delivery) =>
                  delivery.publishedAt ? (
                    timestamp(delivery.publishedAt)
                  ) : (
                    <span className="text-muted">—</span>
                  ),
              },
              {
                key: "result",
                header: "Result",
                className: "min-w-48 max-w-xs",
                cell: (delivery) => (
                  <div className="grid justify-items-start gap-2">
                    {delivery.publishedUrl ? (
                      <a
                        href={delivery.publishedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent underline"
                      >
                        View post
                      </a>
                    ) : delivery.error ? (
                      <TooltipText
                        tooltip={delivery.error}
                        className={`max-w-xs line-clamp-2 ${delivery.nextAttemptAt ? "text-muted" : "text-danger"}`}
                      >
                        {delivery.error}
                      </TooltipText>
                    ) : delivery.providerPostId ? (
                      <span>Published</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                    {session.user.role !== "viewer" &&
                      post.resumableConnectionIds.includes(
                        delivery.connectionId,
                      ) &&
                      post.deliveries.find(
                        (item) =>
                          item.connectionId === delivery.connectionId &&
                          item.state === "failed",
                      )?.id === delivery.id && (
                        <Button
                          variant="secondary"
                          onPress={() =>
                            setResume({
                              delivery,
                              version: post.version,
                              remainingCount: post.deliveries.filter(
                                (item) =>
                                  item.connectionId === delivery.connectionId &&
                                  item.state === "failed",
                              ).length,
                            })
                          }
                        >
                          Resume publishing
                        </Button>
                      )}
                  </div>
                ),
              },
            ]}
          />
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        </div>
      ) : null}
      <Dialog
        open={!!resume}
        onClose={() => setResume(null)}
        title="Resume publishing?"
        isDismissDisabled={busy}
        footer={
          <>
            <Button
              variant="secondary"
              onPress={() => setResume(null)}
              isDisabled={busy}
            >
              Cancel
            </Button>
            <Button onPress={() => void resumePublishing()} isDisabled={busy}>
              {busy ? "Resuming…" : "Resume publishing"}
            </Button>
          </>
        }
      >
        {resume && (
          <div className="grid gap-3 text-sm">
            <PublishingSummary
              accounts={[
                {
                  id: resume.delivery.connectionId,
                  name: resume.delivery.accountName,
                  handle: resume.delivery.accountHandle,
                  provider: resume.delivery.provider,
                },
              ]}
              postCount={resume.remainingCount}
            />
            <p>
              Continue this account's remaining posts now? Already published
              posts will stay in place.{" "}
              {supportsThreads(resume.delivery.provider)
                ? "Remaining replies will stay linked to this thread."
                : "Remaining posts will publish individually in order."}
            </p>
          </div>
        )}
      </Dialog>
    </section>
  );
}
