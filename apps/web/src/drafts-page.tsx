import { useState } from "react";
import {
  Button,
  ButtonLink,
  Dialog,
  ResourceTable,
  ResourceName,
  Pagination,
  QueryLoading,
  toast,
  Avatar,
  TooltipText,
  Link,
} from "@posted/web-design-system";
import { HugeiconsIcon } from "@hugeicons/react";
import { QuillWrite01Icon, QuillWrite02Icon } from "@hugeicons/core-free-icons";
import type { Page, PostDraft } from "../../../packages/contracts/src/index.js";
import { api, errorText, type Session } from "./api.js";
import { PageHeading } from "./page-heading.js";
import { useResource } from "./use-resource.js";
import { QueryFeedback } from "./query-feedback.js";
import { RelativeDateTime } from "./relative-date-time.js";
import { ProviderIcon, providerNames } from "./social-ui.js";

export function DraftsPage({ session }: { session: Session }) {
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState<PostDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const resource = useResource<Page<PostDraft>>(`/drafts?page=${page}`);
  const data = resource.value;
  const editable = session.user.role !== "viewer";
  async function deleteDraft() {
    if (!deleting || busy) return;
    setBusy(true);
    try {
      await api(
        `/drafts/${deleting.id}`,
        { version: deleting.version },
        "DELETE",
      );
      setDeleting(null);
      resource.refresh();
      toast.success("Draft deleted");
    } catch (error) {
      toast.danger(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="min-w-0">
      <PageHeading
        title="Pending Drafts"
        icon={<HugeiconsIcon icon={QuillWrite02Icon} />}
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
        <QueryLoading>Loading pending drafts…</QueryLoading>
      ) : resource.failed && !data ? (
        <QueryFeedback
          message="Pending drafts could not be loaded."
          onRetry={resource.refresh}
        />
      ) : (
        <div className="grid min-w-0 gap-4">
          <ResourceTable
            ariaLabel="Pending drafts"
            mobileLayout="scroll"
            tableClassName="min-w-3xl"
            items={data?.items ?? []}
            getRowKey={(draft) => draft.id}
            emptyTitle="No pending drafts"
            emptyDescription="Save an idea from the editor and return to it when you're ready to publish."
            columns={[
              {
                key: "post",
                header: "Post",
                isRowHeader: true,
                className: "min-w-64 max-w-sm",
                cell: (draft) => (
                  <ResourceName
                    name={
                      <Link
                        href={`/drafts/${draft.id}/edit`}
                        className="block max-w-sm truncate text-foreground no-underline hover:underline"
                      >
                        {draft.text.trim() ||
                          (draft.media.length
                            ? "Media post"
                            : "Untitled draft")}
                      </Link>
                    }
                    description={`${draft.additionalPosts.length + 1} ${draft.additionalPosts.length ? "posts" : "post"} · ${draft.connectionIds.length} ${draft.connectionIds.length === 1 ? "account" : "accounts"}`}
                  />
                ),
              },
              {
                key: "accounts",
                header: "Accounts",
                cell: (draft) => (
                  <div className="flex gap-2">
                    {draft.connections.map((account) => (
                      <span
                        key={account.id}
                        role="img"
                        aria-label={`${providerNames[account.provider]}: @${account.handle}`}
                        title={`@${account.handle}`}
                      >
                        <ProviderIcon provider={account.provider} />
                      </span>
                    ))}
                  </div>
                ),
              },
              {
                key: "draftedBy",
                header: "Drafted by",
                className: "min-w-44 max-w-56",
                cell: (draft) =>
                  draft.draftedBy ? (
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar
                        email=""
                        name={draft.draftedBy.name}
                        src={draft.draftedBy.avatarUrl}
                        className="size-8 shrink-0"
                        aria-hidden
                      />
                      <TooltipText
                        tooltip={draft.draftedBy.name}
                        className="min-w-0 max-w-40 truncate"
                      >
                        {draft.draftedBy.name}
                      </TooltipText>
                    </div>
                  ) : (
                    <span className="text-muted">Not recorded</span>
                  ),
              },
              {
                key: "updated",
                header: "Last saved",
                cell: (draft) => (
                  <RelativeDateTime
                    value={draft.updatedAt}
                    timeZone={session.user.timeZone}
                    dateFormat={session.user.dateFormat}
                    timeFormat={session.user.timeFormat}
                    label="Last saved"
                    className="whitespace-nowrap"
                  />
                ),
              },
              {
                key: "actions",
                header: "Actions",
                headerClassName: "text-right",
                className: "text-right",
                cell: (draft) =>
                  editable ? (
                    <div className="flex justify-end gap-2">
                      <ButtonLink
                        variant="secondary"
                        href={`/drafts/${draft.id}/edit`}
                      >
                        Edit
                      </ButtonLink>
                      <Button
                        variant="danger-soft"
                        onPress={() => setDeleting(draft)}
                      >
                        Delete
                      </Button>
                    </div>
                  ) : (
                    <ButtonLink
                      variant="secondary"
                      href={`/drafts/${draft.id}/edit`}
                    >
                      View
                    </ButtonLink>
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
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete draft?"
        isDismissDisabled={busy}
        footer={
          <>
            <Button
              variant="secondary"
              isDisabled={busy}
              onPress={() => setDeleting(null)}
            >
              Keep draft
            </Button>
            <Button
              variant="danger-soft"
              isDisabled={busy}
              isPending={busy}
              onPress={() => void deleteDraft()}
            >
              Delete draft
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Permanently delete this draft? This cannot be undone.
        </p>
      </Dialog>
    </section>
  );
}
