import { useState } from "react";
import {
  Attributes,
  Button,
  Pagination,
  ResourceTable,
  TooltipText,
} from "@posted/web-design-system";
import { HugeiconsIcon } from "@hugeicons/react";
import { SentIcon } from "@hugeicons/core-free-icons";
import type { Post } from "../../../packages/contracts/src/index.js";
import type { Session } from "./api.js";
import { PageHeading } from "./page-heading.js";
import { formatDateTime } from "./date-time-preferences.js";
import { useResource } from "./use-resource.js";
import { providerNames, ProviderIcon, StateChip } from "./social-ui.js";

export function PostDetailsPage({
  postId,
  session,
}: {
  postId: string;
  session: Session;
}) {
  const [page, setPage] = useState(1);
  const resource = useResource<{ post: Post }>(`/posts/${postId}`, 5000);
  const post = resource.value?.post;
  const pageSize = 20;
  const totalPages = Math.max(
    1,
    Math.ceil((post?.deliveries.length ?? 0) / pageSize),
  );
  const currentPage = Math.min(page, totalPages);
  const timestamp = (value: string) => formatDateTime(value, session.user);
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
                key: "content",
                header: "Content",
                className: "min-w-64 max-w-sm",
                cell: (delivery) => (
                  <TooltipText
                    tooltip={delivery.textOverride ?? post.text}
                    className="max-w-sm line-clamp-2 whitespace-pre-wrap break-words"
                  >
                    {(delivery.textOverride ?? post.text) || "Image post"}
                  </TooltipText>
                ),
              },
              {
                key: "status",
                header: "Status",
                cell: (delivery) => <StateChip state={delivery.state} />,
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
                cell: (delivery) =>
                  delivery.publishedUrl ? (
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
                      className="max-w-xs line-clamp-2 text-danger"
                    >
                      {delivery.error}
                    </TooltipText>
                  ) : delivery.providerPostId ? (
                    <span>Published</span>
                  ) : (
                    <span className="text-muted">—</span>
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
    </section>
  );
}
