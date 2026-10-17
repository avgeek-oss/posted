import { ScrollShadow } from "@posted/web-design-system";
import type { SocialConnection } from "../../../packages/contracts/src/index.js";
import { supportsThreads } from "../../../packages/contracts/src/threads.js";
import { ProviderIcon, providerNames } from "./social-ui.js";

export function PublishingSummary({
  accounts,
  postCount,
}: {
  accounts: SocialConnection[];
  postCount: number;
}) {
  return (
    <div className="grid min-w-0 gap-3">
      <p className="text-sm font-medium">
        {postCount} {postCount === 1 ? "post" : "posts"} · {accounts.length}{" "}
        {accounts.length === 1 ? "account" : "accounts"}
      </p>
      <ScrollShadow className="max-h-60 overflow-y-auto" size={16}>
        <ul className="grid gap-3" aria-label="Publishing destinations">
          {accounts.map((account) => (
            <li key={account.id} className="flex min-w-0 items-start gap-3">
              <ProviderIcon
                provider={account.provider}
                className="mt-0.5 size-5 shrink-0"
              />
              <div className="min-w-0">
                <p className="truncate text-sm">
                  {account.name} · {providerNames[account.provider]}
                </p>
                <p className="truncate text-xs text-muted">@{account.handle}</p>
                <p className="text-xs text-muted">
                  {postCount === 1
                    ? "One post"
                    : supportsThreads(account.provider)
                      ? `Thread of ${postCount} posts`
                      : `${postCount} individual posts`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </ScrollShadow>
    </div>
  );
}
