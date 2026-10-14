import { HugeiconsIcon } from "@hugeicons/react";
import {
  BookOpen01Icon,
  News01Icon,
  Message01Icon,
} from "@hugeicons/core-free-icons";
import { PageHeading } from "./page-heading.js";
import { postedVersion } from "./brand.js";

export const helpTitles: Record<string, string> = {
  "/help": "Documentation",
  "/help/changelog": "Changelog",
  "/help/feedback": "Feedback",
};

export function HelpPage({ path }: { path: string }) {
  const changelog = path === "/help/changelog";
  const feedback = path === "/help/feedback";
  return (
    <section className="min-w-0">
      <PageHeading
        title={helpTitles[path] ?? "Documentation"}
        icon={
          <HugeiconsIcon
            icon={
              changelog ? News01Icon : feedback ? Message01Icon : BookOpen01Icon
            }
          />
        }
      />
      <div className="mt-8 grid max-w-3xl gap-8 text-sm leading-relaxed">
        <p>
          <a
            className="text-accent underline underline-offset-4"
            href="https://www.posted.cc"
          >
            Read the Posted documentation
          </a>{" "}
          for product guides, installation and operations.
        </p>
        {changelog ? (
          <section>
            <h2 className="text-base font-medium">Version {postedVersion}</h2>
            <p className="mt-3 text-muted">
              This installation includes team-owned connections for X, LinkedIn,
              Bluesky and Threads; drafts; image and video uploads; a shared
              composer with provider previews; scheduling; and per-account
              publishing results.
            </p>
          </section>
        ) : feedback ? (
          <section>
            <h2 className="text-base font-medium">
              Report an issue to your installation administrator
            </h2>
            <p className="mt-3 text-muted">
              Include the page, what you expected, what happened, and this
              installation's version ({postedVersion}). For publishing issues,
              open the post details and include its request key and delivery
              status.
            </p>
            <p className="mt-3 text-muted">
              Screenshots can help explain a problem. Remove personal
              information and credentials before sharing them.
            </p>
          </section>
        ) : (
          <>
            <section>
              <h2 className="text-base font-medium">
                Connect your team's accounts
              </h2>
              <p className="mt-3 text-muted">
                An administrator can add accounts on{" "}
                <a
                  className="text-accent underline underline-offset-4"
                  href="/connections"
                >
                  Connections
                </a>
                . Available providers depend on the installation's
                configuration. You can connect multiple accounts from the same
                provider. Connections belong to the team and are available to
                members with write access.
              </p>
            </section>
            <section>
              <h2 className="text-base font-medium">Compose and schedule</h2>
              <p className="mt-3 text-muted">
                Start on Home, enter your text, and select Continue or Open
                Editor. Choose the accounts to publish to and review each
                preview. If media storage is configured, you can add JPEG, PNG
                or WebP images, or MP4/MOV videos. Posted prepares supported
                media for each provider.
              </p>
              <p className="mt-3 text-muted">
                Save an incomplete idea as a draft, confirm Post now, or choose
                Schedule for later. Scheduling uses the timezone in your account
                preferences. Open Scheduled Posts to edit a future post in the
                same composer or cancel it.
              </p>
            </section>
            <section>
              <h2 className="text-base font-medium">
                Check publishing results
              </h2>
              <p className="mt-3 text-muted">
                Open a post's details to see each account's result and the group
                request key. Completed requests appear in Post History. A
                Partial result means some accounts succeeded. An Uncertain
                result means the provider may have published the post but did
                not confirm it; check that account before trying again.
              </p>
            </section>
            <section id="mcp">
              <h2 className="text-base font-medium">Connect an MCP client</h2>
              <p className="mt-3 text-muted">
                Use the configuration on{" "}
                <a
                  className="text-accent underline underline-offset-4"
                  href="/settings/mcp"
                >
                  MCP Guide
                </a>{" "}
                and approve the OAuth connection. Choose Read-only, Write or
                Administrator. Access remains limited by your current team role,
                and a role change revokes the connection. You can also revoke it
                in MCP Connections.
              </p>
            </section>
          </>
        )}
      </div>
    </section>
  );
}
