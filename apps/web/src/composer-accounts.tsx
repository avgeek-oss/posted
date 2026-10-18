import { useState } from "react";
import { Checkbox } from "@heroui/react";
import {
  Button,
  Dialog,
  ScrollShadow,
  TextField,
  Tooltip,
} from "@posted/web-design-system";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";
import type { SocialConnection } from "../../../packages/contracts/src/index.js";
import { AccountAvatar, ProviderIcon, providerNames } from "./social-ui.js";

export function ComposerAccounts({
  accounts,
  selected,
  activeId,
  locked,
  errors,
  customAccountIds,
  onChange,
  onActiveChange,
}: {
  accounts: SocialConnection[];
  selected: string[];
  activeId?: string;
  locked: boolean;
  errors: Record<string, string>;
  customAccountIds: ReadonlySet<string>;
  onChange: (ids: string[]) => void;
  onActiveChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [draftSelected, setDraftSelected] = useState<string[]>([]);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const removedCustomIds = selected.filter(
    (id) => !draftSelected.includes(id) && customAccountIds.has(id),
  );
  function closeChooser() {
    setOpen(false);
    setConfirmingRemoval(false);
  }
  function applySelection() {
    if (locked) return;
    onChange(draftSelected);
    closeChooser();
  }
  const query = search.trim().toLowerCase();
  const results = accounts.filter((account) =>
    `${account.name} ${account.handle} ${providerNames[account.provider]}`
      .toLowerCase()
      .includes(query),
  );
  const chosen = accounts.filter((account) => selected.includes(account.id));
  return (
    <section className="grid min-w-0 gap-4" aria-label="Selected accounts">
      <div className="@container flex min-w-0 items-center gap-3">
        <ScrollShadow
          orientation="horizontal"
          hideScrollBar
          size={24}
          className="flex min-w-0 flex-1 gap-3 overflow-x-auto overscroll-x-contain p-1"
          aria-label="Account content and previews"
        >
          {chosen.map((account) => (
            <Tooltip key={account.id}>
              <Tooltip.Trigger<"span">
                className="shrink-0"
                role="presentation"
                tabIndex={-1}
                render={(props) => <span {...props} />}
              >
                <Button
                  isIconOnly
                  variant="tertiary"
                  className={`size-12 shrink-0 overflow-visible rounded-full p-1 ${account.id === activeId ? "ring-2 ring-accent" : ""}`}
                  aria-label={`${account.name}, ${providerNames[account.provider]}, @${account.handle}${errors[account.id] ? `: ${errors[account.id]}` : ""}`}
                  aria-pressed={account.id === activeId}
                  onPress={() => onActiveChange(account.id)}
                >
                  <AccountAvatar
                    account={account}
                    error={errors[account.id]}
                    providerBadgeSize="md"
                  />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>
                <span className="grid gap-0.5">
                  <span>{account.name}</span>
                  <span>@{account.handle}</span>
                </span>
                {errors[account.id] && (
                  <p className="mt-1 text-danger">{errors[account.id]}</p>
                )}
              </Tooltip.Content>
            </Tooltip>
          ))}
        </ScrollShadow>
        <div
          className={`shrink-0 transition-[translate] duration-220 ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:transition-none ${chosen.length ? "translate-x-0" : "translate-x-[calc(100%_-_100cqw)]"}`}
        >
          <Button
            variant="secondary"
            isDisabled={locked}
            onPress={() => {
              setSearch("");
              setDraftSelected([...selected]);
              setConfirmingRemoval(false);
              setOpen(true);
            }}
          >
            <HugeiconsIcon icon={Add01Icon} size={16} aria-hidden />
            Choose Accounts
          </Button>
        </div>
      </div>
      <Dialog
        open={open}
        onClose={closeChooser}
        title={
          confirmingRemoval
            ? `Remove ${removedCustomIds.length === 1 ? "account" : "accounts"} with custom content?`
            : "Choose Accounts"
        }
        footer={
          confirmingRemoval ? (
            <>
              <Button autoFocus variant="secondary" onPress={closeChooser}>
                Cancel
              </Button>
              <Button
                variant="danger"
                isDisabled={locked}
                onPress={applySelection}
              >
                Remove {removedCustomIds.length === 1 ? "account" : "accounts"}
              </Button>
            </>
          ) : (
            <Button
              isDisabled={locked}
              onPress={() => {
                if (removedCustomIds.length) setConfirmingRemoval(true);
                else applySelection();
              }}
            >
              {draftSelected.length
                ? `Choose ${draftSelected.length} ${draftSelected.length === 1 ? "account" : "accounts"}`
                : "Choose accounts"}
            </Button>
          )
        }
      >
        {confirmingRemoval ? (
          <div className="grid gap-4">
            <p className="text-sm text-muted">
              Removing{" "}
              {removedCustomIds.length === 1
                ? "this account"
                : "these accounts"}{" "}
              from the sequence will discard their custom content across all
              posts. This cannot be undone.
            </p>
            <ul className="grid max-h-[35dvh] gap-2 overflow-y-auto">
              {removedCustomIds.map((id) => {
                const account = accounts.find((item) => item.id === id);
                return (
                  <li
                    key={id}
                    className="flex min-w-0 items-center gap-2 text-sm"
                  >
                    {account ? (
                      <>
                        <ProviderIcon provider={account.provider} />
                        <span>
                          <span className="sr-only">
                            {providerNames[account.provider]}:{" "}
                          </span>
                          {account.name} · @{account.handle}
                        </span>
                      </>
                    ) : (
                      "Unavailable account"
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-4">
            <TextField
              label="Search accounts"
              type="search"
              placeholder="Name or handle…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <ScrollShadow
              orientation="vertical"
              hideScrollBar
              size={24}
              className="max-h-[45dvh] overflow-y-auto overscroll-contain"
              aria-label="Account results"
            >
              {results.map((account) => (
                <Checkbox
                  key={account.id}
                  variant="secondary"
                  className="w-full flex-row items-center gap-3 rounded-xl px-0 py-3"
                  isSelected={draftSelected.includes(account.id)}
                  isDisabled={
                    locked ||
                    (!draftSelected.includes(account.id) &&
                      ((account.state !== "connected" &&
                        !selected.includes(account.id)) ||
                        draftSelected.length >= 50))
                  }
                  aria-label={`${account.name}, ${providerNames[account.provider]}, @${account.handle}${account.state !== "connected" ? ", reconnect required" : ""}`}
                  onChange={(checked) =>
                    setDraftSelected(
                      checked
                        ? [...draftSelected, account.id]
                        : draftSelected.filter((id) => id !== account.id),
                    )
                  }
                >
                  <Checkbox.Content className="flex min-w-0 flex-1 flex-row items-center gap-3">
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    <AccountAvatar account={account} providerBadgeSize="md" />
                    <span className="grid min-w-0 gap-0.5">
                      <span
                        className="truncate font-medium"
                        title={account.name}
                      >
                        {account.name}
                      </span>
                      <span className="truncate text-xs text-muted">
                        @{account.handle}
                      </span>
                      {account.state !== "connected" && (
                        <span className="text-xs text-muted">
                          Reconnect before posting
                        </span>
                      )}
                    </span>
                  </Checkbox.Content>
                </Checkbox>
              ))}
              {!results.length && accounts.length > 0 && (
                <p className="py-6 text-sm text-muted">No matching accounts.</p>
              )}
            </ScrollShadow>
            {draftSelected.length >= 50 && (
              <p className="text-xs text-muted">Up to 50 accounts per post</p>
            )}
          </div>
        )}
      </Dialog>
    </section>
  );
}
