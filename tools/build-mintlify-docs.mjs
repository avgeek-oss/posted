import { cp, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const { syncSite } = await import(
  new URL(
    "../bin/mintlify-docs.mjs",
    import.meta.resolve("@avgeek-oss/mintlify-docs"),
  )
);

const root = fileURLToPath(new URL("../", import.meta.url));
const dir = resolve(root, "docs");
const check = process.argv.includes("--check");
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
  `${check ? "Checked" : "Generated"} Posted Mintlify configuration, brand assets and shared components.`,
);
