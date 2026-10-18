import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve, dirname, extname } from "node:path";
import sharp from "sharp";
import { compile } from "@mdx-js/mdx";
const root = process.cwd();
const dir = resolve(root, "docs");
const site = JSON.parse(await readFile(resolve(dir, "docs.json"), "utf8"));
assert.equal(site.name, "Posted");
assert.equal(site.seo.metatags.canonical, "https://www.posted.cc");
function pageRoutes(items) {
  return items.flatMap((item) =>
    typeof item === "string"
      ? [item]
      : pageRoutes(item.pages ?? item.groups ?? []),
  );
}
const routes = pageRoutes(
  site.navigation.dropdowns.flatMap((item) => item.groups),
);
assert.equal(new Set(routes).size, routes.length);
for (const route of routes) {
  const body = await readFile(resolve(dir, route + ".mdx"), "utf8");
  await compile(body);
  assert(
    /^---\n[\s\S]*title: .+[\s\S]*description: .+[\s\S]*?\n---/.test(body),
    `${route} needs metadata`,
  );
}
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      [
        "node_modules",
        ".git",
        "dist",
        "tmp",
        "artifacts",
        "design",
        "local-data",
      ].includes(entry.name)
    )
      continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if ([".md", ".mdx"].includes(extname(path))) files.push(path);
  }
}
await walk(root);
for (const path of files) {
  const body = (await readFile(path, "utf8"))
    .replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, "")
    .replace(/`[^`\n]*`/g, "");
  const links = [
    ...body.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g),
    ...body.matchAll(/(?:href|light|dark|src)="([^"]+)"/g),
  ];
  for (const match of links) {
    const destination = match[1].split("#")[0];
    if (!destination || /^(https?:|mailto:)/.test(destination)) continue;
    const target =
      path.startsWith(dir + "/") && destination.startsWith("/")
        ? resolve(dir, destination.slice(1))
        : resolve(dirname(path), destination);
    let found = false;
    for (const candidate of [target, target + ".mdx"])
      try {
        await stat(candidate);
        found = true;
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    assert(found, `${path}: missing ${destination}`);
  }
}
const screenshots = JSON.parse(
  await readFile(resolve(dir, "screenshots.json"), "utf8"),
);
for (const capture of screenshots)
  for (const theme of ["light", "dark"]) {
    const metadata = await sharp(
      resolve(dir, "assets/screenshots", `${capture.name}-${theme}.jpg`),
    ).metadata();
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.width, capture.width);
    assert.equal(metadata.height, capture.height);
  }
console.log(
  `PASS ${routes.length} routes, ${files.length} source pages and ${screenshots.length * 2} screenshot assets.`,
);
