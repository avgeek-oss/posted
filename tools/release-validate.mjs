import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
const root = JSON.parse(await readFile("package.json", "utf8"));
assert.match(
  root.version,
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/,
);
for (const path of ["apps/web/package.json", "apps/web-server/package.json"])
  assert.equal(
    JSON.parse(await readFile(path, "utf8")).version,
    root.version,
    `${path} version`,
  );
const compose = parse(await readFile("docker-compose.yml", "utf8"), {
  merge: true,
});
for (const component of ["api", "worker", "web"]) {
  const service = compose.services[component];
  assert.equal(
    service.image,
    `ghcr.io/avgeek-oss/posted-${component}:\${POSTED_VERSION:-${root.version}}`,
  );
  assert.equal(service.read_only, true);
  assert.deepEqual(service.cap_drop, ["ALL"]);
  assert(service.tmpfs.every((value) => value.startsWith("/tmp:")));
  assert.equal(
    service.build,
    undefined,
    "Published images must not require source builds",
  );
}
assert.equal(
  compose.services.worker.ports,
  undefined,
  "The worker stays private",
);
assert.equal(
  compose.services.worker.depends_on.api.condition,
  "service_healthy",
);
const registry = await readFile(".npmrc", "utf8");
assert(registry.includes("@avgeek-oss:registry=https://registry.npmjs.org"));
assert(!registry.includes("_authToken"));
const env = await readFile(".env.example", "utf8");
assert(env.includes(`POSTED_VERSION=${root.version}`));
assert(!env.includes("POSTED_NPMRC_FILE"));
if (process.env.RELEASE_TAG)
  assert.equal(process.env.RELEASE_TAG, `v${root.version}`);
console.log(
  `PASS Release version ${root.version}, three images, public dependencies and private runtime boundaries.`,
);
