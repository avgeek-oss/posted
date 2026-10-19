import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import sharp from "sharp";
import { app } from "../apps/api/src/app.js";
import { config } from "../apps/api/src/config.js";
import { prepareNextMedia } from "../apps/worker/src/media.js";
import type { Provider } from "../packages/contracts/src/index.js";
import { sql } from "../packages/database/src/index.js";

const settings = config();
const loopback = (value: string) =>
  ["localhost", "127.0.0.1"].includes(new URL(value).hostname);
if (
  settings.NODE_ENV === "production" ||
  ![
    settings.DATABASE_URL,
    settings.POSTED_WEB_URL,
    settings.POSTED_API_URL,
    settings.POSTED_S3_ENDPOINT,
  ].every((value) => value && loopback(value)) ||
  (settings.POSTED_S3_BUCKET !== "posted-preview" &&
    !(
      settings.POSTED_S3_BUCKET?.startsWith("posted-docs-") &&
      process.env.POSTED_DB_SCHEMA?.startsWith("docs_")
    ))
)
  throw new Error("Draft fixtures require disposable loopback preview storage");

type Asset = "landscape" | "portrait" | "square" | "video";
type Part = {
  text: string;
  assets: Asset[];
  overrides?: Partial<Record<Provider, string>>;
};
const fixtures: {
  id: string;
  providers: Provider[];
  posts: Part[];
}[] = [
  {
    id: "c0c10000-0000-4000-8000-000000000001",
    providers: ["bluesky", "linkedin", "threads", "x"],
    posts: [
      {
        text: "Studio update: one idea, four audiences. A few snapshots from this week's work: the big picture, the details and the next step. What are you making this week?",
        assets: ["landscape", "portrait"],
        overrides: {
          linkedin:
            "Studio update: a look at how our team turns one idea into a clear story for every audience. This week's highlights are in the carousel. What helps your team move from an idea to a finished piece of work?",
          x: "One idea, four audiences. This week's studio notes in two frames. What are you making?",
        },
      },
    ],
  },
  {
    id: "c0c10000-0000-4000-8000-000000000002",
    providers: ["bluesky", "linkedin", "threads"],
    posts: [
      {
        text: "Behind the scenes: a short motion study from the studio. Small experiments help us find the direction before we commit to the details.",
        assets: ["video"],
        overrides: {
          threads:
            "A tiny behind-the-scenes motion study. Sometimes four seconds is enough to get an idea moving. What have you been experimenting with?",
        },
      },
    ],
  },
  {
    id: "c0c10000-0000-4000-8000-000000000003",
    providers: ["bluesky", "threads", "x"],
    posts: [
      {
        text: "Field notes: from a rough idea to a finished story. Three things we learned while building this week. A short thread.",
        assets: ["landscape"],
      },
      {
        text: "1. Start with the detail that matters. A useful constraint gives the work a direction and makes the next decision easier.",
        assets: ["portrait", "square"],
        overrides: {
          bluesky:
            "1. Start with one useful constraint. For us, it was making the next decision easier to see. These are the detail studies that helped.",
        },
      },
      {
        text: "2. Leave room to revise. Share an early version, listen carefully and keep the part that makes the story clearer. What would you add?",
        assets: [],
        overrides: {
          x: "2. Share early, listen carefully, then revise. What helps you turn a rough idea into something worth sharing?",
        },
      },
    ],
  },
  {
    id: "c0c10000-0000-4000-8000-000000000004",
    providers: ["bluesky", "linkedin", "threads"],
    posts: [
      {
        text: "Shipping notes: a small studio retrospective in four parts. This week we focused on making everyday work a little calmer.",
        assets: ["square"],
      },
      {
        text: "First, we explored the motion. Here's a short study of how a few moving pieces can still feel like one coherent story.",
        assets: ["video"],
      },
      {
        text: "Then we worked through the details: clearer labels, less friction and enough breathing room for the content to lead.",
        assets: ["portrait", "landscape"],
        overrides: {
          linkedin:
            "The detail pass focused on clearer labels, fewer interruptions and predictable controls. Small improvements add up when a team uses the same workflow every day.",
        },
      },
      {
        text: "Next week: take these ideas into a real workflow and learn what still needs attention. Which small improvement made the biggest difference to your week?",
        assets: [],
        overrides: {
          threads:
            "That's this week's studio retrospective. Next up: trying these ideas in a real workflow. What's one small thing that made your week easier?",
        },
      },
    ],
  },
];

async function assetBytes(asset: Asset) {
  if (asset === "video") {
    const directory = await mkdtemp(join(tmpdir(), "posted-preview-video-"));
    try {
      const path = join(directory, "motion-study.mp4");
      await promisify(execFile)(
        "ffmpeg",
        [
          "-nostdin",
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=640x360:rate=24",
          "-t",
          "4",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-threads",
          "2",
          "-movflags",
          "+faststart",
          path,
        ],
        { timeout: 30_000 },
      );
      return await readFile(path);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  const source = new URL(
    asset === "portrait"
      ? "./fixtures/photos/forest-trail.jpg"
      : "./fixtures/photos/mountain-lake.jpg",
    import.meta.url,
  );
  const image = sharp(await readFile(source));
  if (asset === "square") image.resize(1080, 1080);
  return image.png().toBuffer();
}

function requiredId<Key>(ids: Map<Key, string>, key: Key) {
  const id = ids.get(key);
  if (!id)
    throw new Error(
      "A required preview fixture account or media item is missing",
    );
  return id;
}

let cookie = "";
async function request(path: string, body?: unknown) {
  const response = await app.request(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: settings.POSTED_WEB_URL,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok)
    throw new Error(
      `Preview fixture request failed: ${path} (${response.status})`,
    );
  return response;
}

try {
  const [team] = await sql<
    { id: string; name: string }[]
  >`SELECT id,name FROM workspace`;
  if (team?.name !== "Posted Preview")
    throw new Error("This is not the disposable preview installation");
  const accounts = await sql<{ id: string; provider: Provider }[]>`
    SELECT id,provider FROM social_connections WHERE workspace_id=${team.id}
    AND account_id='preview-' || provider AND state='connected'`;
  const accountIds = new Map(
    accounts.map((account) => [account.provider, account.id]),
  );
  if (
    fixtures.some((fixture) =>
      fixture.providers.some((provider) => !accountIds.has(provider)),
    )
  )
    throw new Error(
      "Run tools/local-preview.ts to create the preview accounts first",
    );
  const pending = [];
  for (const fixture of fixtures) {
    const [existing] =
      await sql`SELECT id FROM post_drafts WHERE id=${fixture.id}`;
    if (!existing) pending.push(fixture);
  }
  if (!pending.length)
    console.log("All four preview drafts already exist; edits preserved.");
  else {
    const login = await request("/api/auth/login", {
      email: "local@avgeek.ltd",
      password: "test123",
    });
    cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    if (!cookie)
      throw new Error("The preview fixture administrator could not sign in");
    const mediaIds = new Map<Asset, string>();
    for (const asset of new Set(
      pending.flatMap((fixture) =>
        fixture.posts.flatMap((post) => post.assets),
      ),
    )) {
      const fileName = `posted-preview-${asset}-v1.${asset === "video" ? "mp4" : "png"}`;
      const [existing] = await sql<
        { id: string }[]
      >`SELECT id FROM post_media WHERE workspace_id=${team.id} AND file_name=${fileName} AND state='ready' ORDER BY created_at LIMIT 1`;
      if (existing) {
        mediaIds.set(asset, existing.id);
        continue;
      }
      const bytes = await assetBytes(asset);
      const contentType = asset === "video" ? "video/mp4" : "image/png";
      const upload = (await (
        await request("/api/media/uploads", {
          fileName,
          contentType,
          sizeBytes: bytes.length,
          alt:
            asset === "video"
              ? "Four-second moving color-pattern study for local video preview testing."
              : asset === "portrait"
                ? "A forest trail surrounded by tall trees and ferns, photographed by Dave Hoefler."
                : "A boathouse beside a mountain lake, photographed by Luca Bravo.",
        })
      ).json()) as {
        mediaId: string;
        uploadUrl: string;
        headers: Record<string, string>;
      };
      if (!loopback(upload.uploadUrl))
        throw new Error("Fixture uploads must stay on loopback storage");
      const uploaded = await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: upload.headers,
        body: new Uint8Array(bytes),
      });
      if (!uploaded.ok)
        throw new Error(`Preview media upload failed (${uploaded.status})`);
      await request(`/api/media/${upload.mediaId}/complete`, {});
      const deadline = Date.now() + 30_000;
      for (;;) {
        const status = (await (
          await request(`/api/media/${upload.mediaId}/status`)
        ).json()) as { state: string };
        if (status.state === "ready") break;
        if (Date.now() >= deadline)
          throw new Error("Preview video preparation did not finish");
        await prepareNextMedia();
        await delay(250);
      }
      mediaIds.set(asset, upload.mediaId);
    }
    for (const fixture of pending) {
      const parts = fixture.posts.map((part) => ({
        text: part.text,
        mediaIds: part.assets.map((asset) => requiredId(mediaIds, asset)),
        textOverrides: Object.fromEntries(
          Object.entries(part.overrides ?? {}).map(([provider, text]) => [
            requiredId(accountIds, provider as Provider),
            text,
          ]),
        ),
      }));
      const [root, ...additionalPosts] = parts;
      await request(`/api/drafts/${fixture.id}`, {
        ...root,
        additionalPosts,
        connectionIds: fixture.providers.map((provider) =>
          requiredId(accountIds, provider),
        ),
        version: 0,
        idempotencyKey: `preview-draft-v1:${fixture.id}`,
      });
      console.log(
        `Created preview draft: ${fixture.posts.length} post(s), ${fixture.providers.length} accounts, ${fixture.posts.reduce((count, post) => count + post.assets.length, 0)} media attachment(s).`,
      );
    }
  }
} finally {
  try {
    if (cookie) await request("/api/auth/logout", {});
  } finally {
    await sql.end();
  }
}
