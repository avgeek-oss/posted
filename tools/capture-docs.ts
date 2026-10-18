import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright";
import sharp from "sharp";

const fixture = JSON.parse(await readFile("tmp/docs-preview.json", "utf8")) as {
  ui: string;
  api: string;
  composerId: string;
  historyId: string;
  schema: string;
  bucket: string;
};
for (const origin of [fixture.ui, fixture.api])
  assert.equal(new URL(origin).hostname, "127.0.0.1");
assert.equal(new URL(fixture.ui).port, "4392");
assert.equal(new URL(fixture.api).port, "4391");
assert(fixture.schema.startsWith("docs_"));
assert(fixture.bucket.startsWith("posted-docs-"));
const captures = JSON.parse(
  await readFile("docs/screenshots.json", "utf8"),
) as {
  name: string;
  width: number;
  height: number;
  pixelRatio: number;
}[];
const requested = [...new Set(process.argv.slice(2))];
for (const name of requested)
  assert(
    captures.some((capture) => capture.name === name),
    `Unknown scene: ${name}`,
  );
const scenes = captures.filter(
  (capture) => !requested.length || requested.includes(capture.name),
);
const output = resolve("docs/assets/screenshots");
await mkdir(output, { recursive: true });
const draft = "/drafts/c0c10000-0000-4000-8000-000000000001/edit";
const browser = await chromium.launch();
const evidence: object[] = [];

async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .filter((button) =>
        button
          .getAttribute("aria-label")
          ?.startsWith("Preview posted-preview-"),
      )
      .every((button) => !button.disabled),
  );
  await page.waitForFunction(() =>
    Array.from(document.images)
      .filter(
        (image) =>
          image.currentSrc &&
          image.checkVisibility({ opacityProperty: true }) &&
          image.getBoundingClientRect().top < innerHeight,
      )
      .every((image) => image.complete && image.naturalWidth > 0),
  );
}

try {
  for (const theme of ["light", "dark"] as const) {
    const context = await browser.newContext({
      deviceScaleFactor: 2,
      colorScheme: theme,
      reducedMotion: "reduce",
      timezoneId: "Asia/Kolkata",
    });
    const blocked: string[] = [];
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
        await route.abort();
      } else if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
        blocked.push(`${request.method()} ${url.pathname}`);
        await route.abort();
      } else await route.continue();
    });
    const login = await context.request.post(`${fixture.api}/api/auth/login`, {
      headers: { Origin: fixture.ui },
      data: { email: "local@avgeek.ltd", password: "test123" },
    });
    assert.equal(
      login.status(),
      200,
      "Disposable documentation sign-in failed",
    );
    const page = await context.newPage();
    async function open(path: string, heading: string) {
      await page.goto(fixture.ui + path);
      await page.getByRole("heading", { name: heading, exact: true }).waitFor();
      const switchTheme = page.getByRole("button", {
        name: `Appearance: switch to ${theme} theme`,
        exact: true,
      });
      if (await switchTheme.count()) await switchTheme.click();
    }
    async function composer() {
      await open(draft, "Edit Draft");
      await page
        .getByRole("button", {
          name: "Preview posted-preview-landscape-v1.png",
          exact: true,
        })
        .waitFor();
      await settled(page);
      assert.equal(
        await page
          .getByRole("button", { name: /^Preview posted-preview-/ })
          .count(),
        2,
        "The demo must contain two images",
      );
    }
    for (const capture of scenes) {
      assert.equal(
        capture.pixelRatio,
        2,
        "Documentation captures require Retina density",
      );
      await page.setViewportSize({
        width: capture.width,
        height: capture.height,
      });
      console.log(`Preparing ${capture.name} (${theme})`);
      switch (capture.name) {
        case "personal-api-keys":
          await open("/settings/api-keys", "API Keys");
          await page.getByText("Draft reader", { exact: true }).waitFor();
          break;
        case "team-api-keys":
          await open("/team-settings/team-api-keys", "Team API Keys");
          await page
            .getByText("Publishing automation", { exact: true })
            .waitFor();
          break;
        case "mcp-guide":
          await open("/settings/mcp", "MCP Guide");
          await page.getByLabel("MCP configuration", { exact: true }).waitFor();
          break;
        case "mcp-connections":
          await open("/settings/mcp-connections", "MCP Connections");
          await page
            .getByText("Codex", { exact: true })
            .filter({ visible: true })
            .first()
            .waitFor();
          break;
        case "composer":
        case "composer-mobile":
          await composer();
          break;
        case "account-edit":
          await composer();
          await page
            .getByLabel("Alex Morgan, LinkedIn, @alexmorgan", { exact: true })
            .click();
          await page.getByRole("tab", { name: "Edit", exact: true }).click();
          await page
            .getByRole("button", {
              name: "Reset post 1 to master",
              exact: true,
            })
            .waitFor();
          await page.waitForFunction(
            () =>
              document.querySelectorAll(
                'button[aria-label^="Preview posted-preview-"]',
              ).length === 4,
          );
          break;
        case "media-preview":
          await composer();
          await page
            .getByRole("button", {
              name: "Preview posted-preview-landscape-v1.png",
              exact: true,
            })
            .click();
          await page.getByRole("dialog").waitFor();
          await page
            .getByRole("heading", {
              name: /^posted-preview-landscape-v1\.png/,
            })
            .waitFor();
          break;
        case "publish-confirmation":
          await composer();
          await page
            .getByRole("button", { name: "Post in 4 accounts", exact: true })
            .click();
          await page
            .getByRole("heading", { name: "Publish now?", exact: true })
            .waitFor();
          assert.equal(
            await page
              .getByRole("list", { name: "Publishing destinations" })
              .getByRole("listitem")
              .count(),
            4,
          );
          break;
        case "scheduling-dialog":
          await composer();
          await page
            .getByRole("button", {
              name: "More publishing options",
              exact: true,
            })
            .click();
          await page
            .getByRole("menuitem", { name: "Schedule for later", exact: true })
            .click();
          await page
            .getByRole("button", {
              name: /^Choose publishing date and time/,
            })
            .click();
          await page.getByText("Time", { exact: true }).waitFor();
          break;
        case "sequence":
          await open(`/posts/${fixture.composerId}/edit`, "Edit Schedule");
          await page
            .getByRole("button", { name: "Choose Accounts", exact: true })
            .waitFor();
          if (
            await page
              .getByRole("button", { name: "Expand post 1", exact: true })
              .count()
          )
            await page
              .getByRole("button", { name: "Expand post 1", exact: true })
              .click();
          await page
            .getByRole("list", { name: "Thread preview", exact: true })
            .waitFor();
          break;
        case "scheduled":
          await open("/posts/scheduled", "Scheduled Posts");
          await page
            .getByRole("rowheader")
            .filter({ hasText: "Meet Posted." })
            .waitFor();
          break;
        case "connections":
          await open("/connections", "Connections");
          await page
            .getByRole("button", { name: /Disconnect Alex Morgan, Bluesky/ })
            .waitFor();
          break;
        case "drafts":
          await open("/posts/drafts", "Pending Drafts");
          await page
            .getByRole("link", {
              name: /Shipping notes: a small studio retrospective/,
            })
            .waitFor();
          break;
        case "details":
          await open(`/posts/${fixture.historyId}`, "Delivery details");
          await page.getByText("Delivery set", { exact: true }).waitFor();
          break;
        case "history":
          await open("/posts/history", "Publish History");
          await page
            .getByRole("rowheader")
            .filter({ hasText: "Studio notes:" })
            .waitFor();
          break;
        default:
          throw new Error(`No documentation scene for ${capture.name}`);
      }
      await settled(page);
      assert(
        !/posted_[A-Za-z0-9_-]{43}/.test(
          await page.locator("body").innerText(),
        ),
        "A full API key must not appear in documentation screenshots",
      );
      const file = `${capture.name}-${theme}@2x.png`;
      await page.screenshot({
        path: resolve(output, file),
        type: "png",
        scale: "device",
        animations: "disabled",
        caret: "hide",
      });
      const metadata = await sharp(resolve(output, file)).metadata();
      assert.equal(metadata.width, capture.width * 2);
      assert.equal(metadata.height, capture.height * 2);
      assert.equal(await page.evaluate(() => devicePixelRatio), 2);
      assert.deepEqual(blocked, [], "Screenshot capture attempted a mutation");
      evidence.push({
        file,
        width: metadata.width,
        height: metadata.height,
        pixelRatio: 2,
      });
      console.log(`Captured ${file}: ${metadata.width} × ${metadata.height}`);
    }
    await context.close();
  }
  await writeFile(
    requested.length
      ? `tmp/docs-retina-capture-${requested.join("-")}.json`
      : "tmp/docs-retina-capture.json",
    JSON.stringify({ captures: evidence, externalPublications: 0 }, null, 2) +
      "\n",
  );
} finally {
  await browser.close();
}
