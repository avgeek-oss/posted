import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { format } from "prettier";
const { syncSite } = await import(
  new URL(
    "../bin/mintlify-docs.mjs",
    import.meta.resolve("@avgeek-oss/mintlify-docs"),
  )
);

const root = fileURLToPath(new URL("../", import.meta.url));
const dir = resolve(root, "docs");
const check = process.argv.includes("--check");
const pages = JSON.parse(await readFile(resolve(dir, "pages.json"), "utf8"));
const captures = JSON.parse(
  await readFile(resolve(dir, "screenshots.json"), "utf8"),
);
async function emit(path, content) {
  const formatted = await format(content, { parser: "mdx" });
  if (check) {
    if ((await readFile(path, "utf8")) !== formatted)
      throw new Error(`Generated documentation differs: ${path}`);
  } else await writeFile(path, formatted);
}
for (const page of pages) {
  let body = (await readFile(resolve(dir, `${page.name}.md`), "utf8"))
    .replace(/^# [^\n]+\n\n/, "")
    .replace(/\]\(([^)]+)\.md\)/g, (match, destination) =>
      /^(https?:|mailto:)/.test(destination) ? match : `](/${destination})`,
    );
  const images = captures.filter((capture) =>
    capture.pages.includes(page.name),
  );
  const frames = images
    .map((capture) => {
      const frame = `<Screenshot light="/assets/screenshots/${capture.name}-light@${capture.pixelRatio}x.png" dark="/assets/screenshots/${capture.name}-dark@${capture.pixelRatio}x.png" alt=${JSON.stringify(capture.alt)} width={${capture.width}} height={${capture.height}}${capture.portrait ? " portrait" : ""} />\n`;
      const marker = `<!-- screenshot:${capture.name} -->`;
      if (body.includes(marker)) {
        body = body.replace(marker, frame);
        return "";
      }
      return `\n## ${capture.title}\n\n${frame}`;
    })
    .join("\n");
  await emit(
    resolve(dir, `${page.name}.mdx`),
    `---\ntitle: ${JSON.stringify(page.title)}\ndescription: ${JSON.stringify(page.description)}\n${page.sidebarTitle ? `sidebarTitle: ${JSON.stringify(page.sidebarTitle)}\n` : ""}${page.icon ? `icon: ${JSON.stringify(page.icon)}\n` : ""}---\n\n${images.length ? 'import { Screenshot } from "/snippets/oss/screenshot.jsx";\n\n' : ""}${body}${frames}`,
  );
}
await mkdir(resolve(dir, "assets"), { recursive: true });
for (const name of [
  "posted-mark.png",
  "posted-favicon.png",
  "posted-social.png",
]) {
  const input = resolve(root, "apps/web/public/brand", name);
  const output = resolve(dir, "assets", name);
  if (check) {
    if (!(await readFile(input)).equals(await readFile(output)))
      throw new Error(`Brand asset differs: ${name}`);
  } else await cp(input, output);
}
await syncSite({ config: resolve(dir, "site.json"), dir, check });
console.log(
  `${check ? "Checked" : "Generated"} Posted Mintlify guides and shared components.`,
);
