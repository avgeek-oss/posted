import { Chip, ScrollShadow } from "@posted/web-design-system";
import type { SocialConnection } from "../../../packages/contracts/src/index.js";
import { ProviderIcon, providerNames } from "./social-ui.js";

export function PublishingSummary({
  accounts,
  postCount,
}: {
  accounts: SocialConnection[];
  postCount: number;
}) {
  return (
    <ScrollShadow className="max-h-60 min-w-0 overflow-y-auto" size={16}>
      <ul className="grid gap-3" aria-label="Publishing destinations">
        {accounts.map((account) => (
          <li key={account.id} className="flex min-w-0 items-center gap-3">
            <ProviderIcon
              provider={account.provider}
              className="size-5 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                <span className="sr-only">
                  {providerNames[account.provider]}:{" "}
                </span>
                {account.name}
              </p>
              <p className="truncate text-xs text-muted">@{account.handle}</p>
            </div>
            <Chip size="sm" variant="soft" color="accent" className="shrink-0">
              <Chip.Label>
                {postCount} {postCount === 1 ? "post" : "posts"}
              </Chip.Label>
            </Chip>
          </li>
        ))}
      </ul>
    </ScrollShadow>
  );
}
