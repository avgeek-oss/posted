import { useState } from "react";
import { Checkbox } from "@heroui/react";
import {
  Avatar,
  Button,
  Dialog,
  QueryLoading,
  ScrollShadow,
  toast,
} from "@posted/web-design-system";
import type { LinkedInPage } from "../../../packages/contracts/src/index.js";
import { api, errorText } from "./api.js";
import { useResource } from "./use-resource.js";
import { QueryFeedback } from "./query-feedback.js";

export function LinkedInPagesDialog({
  authorizationId,
  onDone,
}: {
  authorizationId: string;
  onDone: () => void;
}) {
  const path = `/social/linkedin-pages/authorizations/${encodeURIComponent(authorizationId)}`;
  const resource = useResource<{ pages: LinkedInPage[] }>(path);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  async function cancel() {
    if (busy) return;
    setBusy(true);
    try {
      await api(path, undefined, "DELETE");
    } catch (error) {
      toast.danger(errorText(error));
    } finally {
      setBusy(false);
      onDone();
    }
  }
  async function connect() {
    if (busy || !selected.length) return;
    setBusy(true);
    try {
      const result = await api<{ connected: number }>(path, {
        accountIds: selected,
      });
      toast.success(
        `${result.connected === 1 ? "Page" : "Pages"} connected to your team`,
      );
      onDone();
    } catch (error) {
      toast.danger(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={() => void cancel()}
      title="Choose LinkedIn Pages"
      isDismissDisabled={busy}
      footer={
        <>
          <Button
            variant="secondary"
            isDisabled={busy}
            onPress={() => void cancel()}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="choose-linkedin-pages"
            isDisabled={busy || !selected.length || resource.failed}
            isPending={busy}
          >
            Connect{" "}
            {selected.length
              ? `${selected.length} ${selected.length === 1 ? "Page" : "Pages"}`
              : "Pages"}
          </Button>
        </>
      }
    >
      {resource.pending && !resource.value ? (
        <QueryLoading>Loading Pages…</QueryLoading>
      ) : resource.failed ? (
        <QueryFeedback
          message="Pages could not be loaded. Reconnect if this request has expired."
          onRetry={resource.refresh}
        />
      ) : resource.value?.pages.length ? (
        <form
          id="choose-linkedin-pages"
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void connect();
          }}
        >
          <p className="text-sm text-muted">
            Choose the Pages your team can publish to. Only the Pages you select
            will be connected.
          </p>
          <ScrollShadow className="max-h-[45dvh] overflow-y-auto" size={16}>
            <div className="grid gap-3">
              {resource.value.pages.map((page) => (
                <Checkbox
                  key={page.accountId}
                  variant="secondary"
                  className="w-full flex-row items-center rounded-xl px-0 py-2"
                  aria-label={`${page.name}, @${page.handle}`}
                  isSelected={selected.includes(page.accountId)}
                  isDisabled={busy}
                  onChange={(checked) =>
                    setSelected((ids) =>
                      checked
                        ? [...ids, page.accountId]
                        : ids.filter((id) => id !== page.accountId),
                    )
                  }
                >
                  <Checkbox.Content className="flex min-w-0 flex-1 flex-row items-center gap-3">
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    <Avatar
                      email=""
                      name={page.name}
                      src={page.avatarUrl ?? undefined}
                      className="size-10 shrink-0"
                      aria-hidden
                    />
                    <span className="grid min-w-0 gap-0.5">
                      <span className="truncate">{page.name}</span>
                      <span className="text-xs text-muted">@{page.handle}</span>
                    </span>
                  </Checkbox.Content>
                </Checkbox>
              ))}
            </div>
          </ScrollShadow>
        </form>
      ) : (
        <p className="text-sm text-muted">
          No Pages with publishing access were found. Sign in with a Page
          administrator and check that your LinkedIn app has Community
          Management API access.
        </p>
      )}
    </Dialog>
  );
}
