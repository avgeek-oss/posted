import { useState } from "react";
import {
  Button,
  ButtonLink,
  Dialog,
  ResourceTable,
  ResourceName,
  Pagination,
  toast,
  Avatar,
  TooltipText,
} from "@posted/web-design-system";
import { HugeiconsIcon } from "@hugeicons/react";
import { Calendar03Icon, QuillWrite01Icon } from "@hugeicons/core-free-icons";
import type { Page, Post } from "../../../packages/contracts/src/index.js";
import { api, errorText, type Session } from "./api.js";
import { PageHeading } from "./page-heading.js";
import { formatDateTime } from "./date-time-preferences.js";
import { useResource } from "./use-resource.js";
import { AccountLogoGroup, StateChip } from "./social-ui.js";
import { RelativeDateTime } from "./relative-date-time.js";

export function PostsPage({
  view,
  session,
}: {
  view: "scheduled" | "history";
  session: Session;
}) {
  const [page, setPage] = useState(1);
  const [cancel, setCancel] = useState<Post | null>(null);
  const [busy, setBusy] = useState(false);
  const resource = useResource<Page<Post>>(
    `/posts?view=${view}&page=${page}`,
    5000,
  );
  const data = resource.value;
  const editable = session.user.role !== "viewer";
  async function cancelPost() {
    if (!cancel) return;
    setBusy(true);
    try {
      await api(`/posts/${cancel.id}`, undefined, "DELETE");
      setCancel(null);
      resource.refresh();
      toast.success("Scheduled post cancelled");
    } catch (error) {
      toast.danger(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  const timestamp = (value: string) =>
    formatDateTime(value, {
      timeZone: session.user.timeZone,
      dateFormat: session.user.dateFormat,
      timeFormat: session.user.timeFormat,
    });
  return (
    <section className="min-w-0">
      <PageHeading
        title={view === "scheduled" ? "Scheduled Posts" : "Publish History"}
        icon={
          <HugeiconsIcon
            icon={view === "scheduled" ? Calendar03Icon : QuillWrite01Icon}
          />
        }
        actions={
          editable ? (
            <ButtonLink href="/posts/new">
              <HugeiconsIcon icon={QuillWrite01Icon} size={16} aria-hidden />
              Create post
            </ButtonLink>
          ) : undefined
        }
      />
      {resource.pending && !data ? (
        <p role="status" className="py-8 text-sm text-muted">
          Loading posts…
        </p>
      ) : resource.failed && !data ? (
        <Button variant="secondary" onPress={resource.refresh}>
          Retry
        </Button>
      ) : (
        <div className="grid min-w-0 gap-4">
          <ResourceTable
            ariaLabel={
              view === "scheduled" ? "Scheduled posts" : "Publish history"
            }
            mobileLayout="scroll"
            tableClassName="min-w-4xl"
            items={data?.items ?? []}
            getRowKey={(post) => post.id}
            getRowHref={
              view === "scheduled"
                ? (post) =>
                    editable &&
                    post.deliveries.every(
                      (delivery) =>
                        delivery.state === "scheduled" &&
                        delivery.attempts === 0,
                    )
                      ? `/posts/${post.id}/edit`
                      : `/posts/${post.id}`
                : undefined
            }
            emptyTitle={
              view === "scheduled"
                ? "Your schedule is clear"
                : "No published posts yet"
            }
            emptyDescription={
              view === "scheduled"
                ? "Create a post and choose when your audience will see it."
                : "Completed deliveries and their individual results will appear here."
            }
            columns={[
              {
                key: "post",
                header: "Post",
                isRowHeader: true,
                className: "min-w-72 max-w-sm",
                cell: (post) => (
                  <ResourceName
                    name={
                      <span className="block max-w-sm truncate">
                        {post.text || "Media post"}
                      </span>
                    }
                    description={`${post.additionalPosts.length + 1} ${post.additionalPosts.length ? "posts" : "post"} · ${post.deliveries.length} ${post.deliveries.length === 1 ? "delivery" : "deliveries"}`}
                  />
                ),
              },
              {
                key: "accounts",
                header: "Accounts",
                className: "whitespace-nowrap",
                cell: (post) => (
                  <AccountLogoGroup
                    accounts={post.deliveries
                      .filter((delivery) => delivery.postIndex === 0)
                      .map((delivery) => ({
                        id: delivery.connectionId,
                        provider: delivery.provider,
                        name: delivery.accountName,
                        handle: delivery.accountHandle,
                        avatarUrl: delivery.accountAvatarUrl,
                      }))}
                  />
                ),
              },
              {
                key: "managedBy",
                header: "Posted by",
                className: "min-w-44 max-w-56",
                cell: (post) =>
                  post.managedBy ? (
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar
                        email=""
                        name={post.managedBy.name}
                        src={post.managedBy.avatarUrl}
                        className="size-8 shrink-0"
                        aria-hidden
                      />
                      <TooltipText
                        tooltip={post.managedBy.name}
                        className="min-w-0 max-w-40 truncate"
                      >
                        {post.managedBy.name}
                      </TooltipText>
                    </div>
                  ) : (
                    <span className="text-muted">Not recorded</span>
                  ),
              },
              {
                key: "time",
                header: view === "scheduled" ? "Scheduled for" : "Requested",
                cell: (post) =>
                  view === "scheduled" ? (
                    <RelativeDateTime
                      value={post.scheduledAt}
                      timeZone={session.user.timeZone}
                      dateFormat={session.user.dateFormat}
                      timeFormat={session.user.timeFormat}
                      label="Scheduled for"
                      className="whitespace-nowrap"
                    />
                  ) : (
                    timestamp(post.createdAt)
                  ),
              },
              {
                key: "status",
                header: "Status",
                cell: (post) => <StateChip state={post.state} />,
              },
              {
                key: "actions",
                header: "Actions",
                headerClassName: "text-right",
                cell: (post) => (
                  <div className="flex justify-end gap-2">
                    {view === "history" && (
                      <ButtonLink
                        href={`/posts/${post.id}`}
                        variant="secondary"
                      >
                        Details
                      </ButtonLink>
                    )}
                    {editable && post.state === "scheduled" && (
                      <>
                        {post.deliveries.every(
                          (delivery) =>
                            delivery.state === "scheduled" &&
                            delivery.attempts === 0,
                        ) && (
                          <ButtonLink
                            href={`/posts/${post.id}/edit`}
                            variant="secondary"
                          >
                            Edit
                          </ButtonLink>
                        )}
                        <Button
                          variant="danger-soft"
                          onPress={() => setCancel(post)}
                        >
                          Cancel
                        </Button>
                      </>
                    )}
                  </div>
                ),
              },
            ]}
          />
          <Pagination
            page={data?.page ?? page}
            totalPages={Math.max(
              1,
              Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 20)),
            )}
            onPageChange={setPage}
          />
        </div>
      )}
      <Dialog
        open={!!cancel}
        onClose={() => setCancel(null)}
        title="Cancel scheduled post?"
        isDismissDisabled={busy}
        footer={
          <>
            <Button
              variant="secondary"
              onPress={() => setCancel(null)}
              isDisabled={busy}
            >
              Keep post
            </Button>
            <Button
              variant="danger-soft"
              onPress={() => void cancelPost()}
              isDisabled={busy}
            >
              Cancel post
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          This stops all remaining scheduled deliveries for this post.
        </p>
      </Dialog>
    </section>
  );
}
