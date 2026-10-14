import { useState } from "react";
import { BrandLockup } from "@avgeek-oss/design-system/media/brand-lockup";
import {
  AuthScreen,
  Button,
  QueryLoading,
  toast,
} from "@posted/web-design-system";
import type { Provider } from "../../../packages/contracts/src/index.js";
import { api, errorText } from "./api.js";
import { useResource } from "./use-resource.js";
import { providerNames, ProviderIcon } from "./social-ui.js";
import { QueryFeedback } from "./query-feedback.js";

export function ProviderAuthorizationPage() {
  const query = new URLSearchParams(window.location.search);
  const provider = query.get("provider") ?? "";
  const state = query.get("state") ?? "";
  const resource = useResource<{
    provider: Provider;
    name: string;
    handle: string;
  }>(
    `/preview/social/authorization?${new URLSearchParams({ provider, state })}`,
  );
  const [busy, setBusy] = useState(false);
  const account = resource.value;
  async function decide(decision: "approve" | "deny") {
    if (!account || busy) return;
    setBusy(true);
    try {
      const result = await api<{ authorizationUrl: string }>(
        "/preview/social/decision",
        { provider: account.provider, state, decision },
      );
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      toast.danger(errorText(error));
      setBusy(false);
    }
  }
  return (
    <AuthScreen
      brand={
        account ? (
          <BrandLockup
            logo={
              <ProviderIcon provider={account.provider} className="size-8" />
            }
          >
            {providerNames[account.provider]}
          </BrandLockup>
        ) : null
      }
      title="Authorize Posted"
    >
      {resource.pending && !account ? (
        <QueryLoading>Loading account…</QueryLoading>
      ) : resource.failed ? (
        <QueryFeedback
          message="This connection request could not be loaded."
          onRetry={resource.refresh}
        />
      ) : account ? (
        <form
          className="grid gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            void decide("approve");
          }}
        >
          <p className="text-sm text-muted">
            Allow Posted to access your profile and publish posts for @
            {account.handle}?
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              isDisabled={busy}
              onPress={() => void decide("deny")}
            >
              Cancel
            </Button>
            <Button type="submit" isPending={busy} isDisabled={busy}>
              Authorize
            </Button>
          </div>
        </form>
      ) : null}
    </AuthScreen>
  );
}
