import { useEffect, useState } from "react";
import {
  Button,
  Choice,
  Dialog,
  ResourceTable,
  ResourceName,
  QueryLoading,
  TextField,
  Avatar,
  Link,
  Tooltip,
  TooltipText,
  toast,
} from "@posted/web-design-system";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Link01Icon,
  Unlink01Icon,
} from "@hugeicons/core-free-icons";
import type {
  Provider,
  ProviderCapabilities,
  SocialConnection,
  SocialConnectionSummary,
} from "../../../packages/contracts/src/index.js";
import { PageHeading } from "./page-heading.js";
import { api, errorText, type Session } from "./api.js";
import { useResource } from "./use-resource.js";
import { providerNames, ProviderIcon, StateChip } from "./social-ui.js";
import { QueryFeedback } from "./query-feedback.js";
import { RelativeDateTime } from "./relative-date-time.js";

export function ConnectionsPage({
  canManage,
  session,
}: {
  canManage: boolean;
  session: Session;
}) {
  const connections = useResource<{ items: SocialConnectionSummary[] }>(
    "/connections",
    5000,
  );
  const providers = useResource<{
    providers: ProviderCapabilities[];
  }>("/providers");
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<Provider | "">("");
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<SocialConnection | null>(null);
  const enabled = providers.value?.providers ?? [];
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get(
      "connection",
    );
    if (result) {
      if (result === "connected")
        toast.success("Account connected to your team");
      else toast.warning("Connection was not approved");
      window.history.replaceState(window.history.state, "", "/connections");
    }
  }, []);
  async function connect() {
    if (!provider) return;
    setBusy(true);
    try {
      const result = await api<{ authorizationUrl: string }>(
        `/social/connect/${provider}`,
        provider === "bluesky" ? { handle } : {},
      );
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      toast.danger(errorText(error));
      setBusy(false);
    }
  }
  async function disconnect() {
    if (!remove) return;
    setBusy(true);
    try {
      await api(`/connections/${remove.id}`, undefined, "DELETE");
      toast.success("Account disconnected");
      setRemove(null);
      connections.refresh();
    } catch (error) {
      toast.danger(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="min-w-0">
      <PageHeading
        title="Connections"
        icon={<HugeiconsIcon icon={Link01Icon} />}
        actions={
          canManage ? (
            <Button
              onPress={() => {
                setProvider(enabled[0]?.id ?? "");
                setOpen(true);
              }}
            >
              <HugeiconsIcon icon={Add01Icon} size={16} aria-hidden />
              Add connection
            </Button>
          ) : undefined
        }
      />
      {connections.pending && !connections.value ? (
        <p className="py-8 text-sm text-muted" role="status">
          Loading connections…
        </p>
      ) : connections.failed && !connections.value ? (
        <Button variant="secondary" onPress={connections.refresh}>
          Retry
        </Button>
      ) : (
        <ResourceTable
          ariaLabel="Team social connections"
          mobileLayout="scroll"
          tableClassName="min-w-6xl"
          getRowKey={(item) => item.id}
          items={connections.value?.items ?? []}
          emptyTitle="Your team's accounts belong here"
          emptyDescription="Connect an account to start sharing posts together."
          columns={[
            {
              key: "account",
              header: "Account",
              isRowHeader: true,
              className: "min-w-60",
              cell: (item) => (
                <div className="flex items-center gap-3">
                  <ProviderIcon
                    provider={item.provider}
                    className="size-5 shrink-0"
                  />
                  <span className="sr-only">
                    {providerNames[item.provider]}
                  </span>
                  <ResourceName
                    name={item.name}
                    description={`@${item.handle}`}
                  />
                </div>
              ),
            },
            {
              key: "scheduledCount",
              header: "Posts scheduled",
              className: "tabular-nums",
              cell: (item) => item.scheduledCount,
            },
            {
              key: "status",
              header: "Status",
              cell: (item) => <StateChip state={item.state} />,
            },
            {
              key: "connectedBy",
              header: "Connected by",
              className: "min-w-44 max-w-56",
              cell: (item) =>
                item.connectedBy ? (
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar
                      email=""
                      name={item.connectedBy.name}
                      src={item.connectedBy.avatarUrl}
                      className="size-8 shrink-0"
                      aria-hidden
                    />
                    <TooltipText
                      tooltip={item.connectedBy.name}
                      className="min-w-0 max-w-40 truncate"
                    >
                      {item.connectedBy.name}
                    </TooltipText>
                  </div>
                ) : (
                  <span className="text-muted">Not recorded</span>
                ),
            },
            {
              key: "connectedOn",
              header: "Connected on",
              className: "whitespace-nowrap",
              cell: (item) => (
                <RelativeDateTime
                  value={item.createdAt}
                  timeZone={session.user.timeZone}
                  dateFormat={session.user.dateFormat}
                  timeFormat={session.user.timeFormat}
                  label="Connected on"
                />
              ),
            },
            {
              key: "lastPublished",
              header: "Last published",
              className: "whitespace-nowrap",
              cell: (item) =>
                item.lastPublished ? (
                  <Link
                    href={`/posts/${item.lastPublished.postId}`}
                    className="w-fit"
                  >
                    <RelativeDateTime
                      value={item.lastPublished.publishedAt}
                      timeZone={session.user.timeZone}
                      dateFormat={session.user.dateFormat}
                      timeFormat={session.user.timeFormat}
                      label="Last published"
                      showAbsolute={false}
                    />
                  </Link>
                ) : (
                  <span className="text-muted">Never published</span>
                ),
            },
            ...(canManage
              ? [
                  {
                    key: "actions",
                    header: "Actions",
                    headerClassName: "text-right",
                    cell: (item: SocialConnectionSummary) => (
                      <div className="flex justify-end gap-2">
                        {item.state === "reauthentication_required" && (
                          <Button
                            variant="secondary"
                            onPress={() => {
                              setProvider(item.provider);
                              setOpen(true);
                            }}
                          >
                            Reconnect
                          </Button>
                        )}
                        <Tooltip>
                          <Tooltip.Trigger<"span">
                            className="inline-flex shrink-0"
                            role="presentation"
                            tabIndex={-1}
                            render={(props) => <span {...props} />}
                          >
                            <Button
                              isIconOnly
                              size="md"
                              variant="danger-soft"
                              aria-label={`Disconnect ${item.name}, ${providerNames[item.provider]}, @${item.handle}`}
                              onPress={() => setRemove(item)}
                            >
                              <HugeiconsIcon
                                icon={Unlink01Icon}
                                size={18}
                                aria-hidden
                              />
                            </Button>
                          </Tooltip.Trigger>
                          <Tooltip.Content>Disconnect account</Tooltip.Content>
                        </Tooltip>
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add connection"
        isDismissDisabled={busy}
        footer={
          <>
            <Button
              variant="secondary"
              onPress={() => setOpen(false)}
              isDisabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="connect-account"
              isDisabled={busy || !provider}
            >
              {busy ? "Connecting…" : "Continue"}
            </Button>
          </>
        }
      >
        {providers.pending && !providers.value ? (
          <QueryLoading>Loading providers…</QueryLoading>
        ) : providers.failed && !providers.value ? (
          <QueryFeedback
            message="Providers could not be loaded."
            onRetry={providers.refresh}
          />
        ) : enabled.length ? (
          <form
            id="connect-account"
            className="content-grid"
            onSubmit={(event) => {
              event.preventDefault();
              void connect();
            }}
          >
            <Choice
              label="Provider"
              value={provider}
              onChange={(key) => {
                const next = enabled.find((item) => item.id === key);
                if (next) setProvider(next.id);
              }}
              items={enabled.map((item) => ({
                id: item.id,
                name: item.name,
                startContent: <ProviderIcon provider={item.id} />,
              }))}
              disabled={busy}
            />
            {provider === "bluesky" && (
              <TextField
                label="Bluesky handle"
                value={handle}
                onChange={(event) => setHandle(event.target.value)}
                placeholder="name.bsky.social"
                required
                maxLength={253}
              />
            )}
            <p className="text-sm leading-relaxed text-muted">
              You'll sign in with the provider. This account will be available
              to everyone with posting access in your team.
            </p>
          </form>
        ) : (
          <p className="text-sm text-muted">
            Ask your installation operator to configure a provider's OAuth
            client ID and secret. Configured providers will appear here.
          </p>
        )}
      </Dialog>
      <Dialog
        open={!!remove}
        onClose={() => setRemove(null)}
        title="Disconnect account?"
        isDismissDisabled={busy}
        footer={
          <>
            <Button
              variant="secondary"
              onPress={() => setRemove(null)}
              isDisabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="danger-soft"
              onPress={() => void disconnect()}
              isDisabled={busy}
            >
              Disconnect
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-muted">
          Disconnect {remove?.name} from your team? Scheduled posts for this
          account will be marked failed. Connecting again does not retry them.
        </p>
      </Dialog>
    </section>
  );
}
