import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { validateReleaseImages } from "./release-images.mjs";
const commit = "a".repeat(40);
const manifest = () => ({
  version: "v0.1.0",
  commit,
  platforms: ["linux/amd64", "linux/arm64"],
  images: Object.fromEntries(
    ["api", "worker", "web"].map((component) => [
      component,
      `ghcr.io/avgeek-oss/posted-${component}@sha256:${"b".repeat(64)}`,
    ]),
  ),
});
test("release manifest rejects missing worker, wrong source, mutable tags and incomplete platforms", () => {
  assert.equal(
    validateReleaseImages(manifest(), "v0.1.0", commit).version,
    "v0.1.0",
  );
  for (const mutate of [
    (value) => delete value.images.worker,
    (value) => {
      value.commit = "c".repeat(40);
    },
    (value) => {
      value.images.api = "ghcr.io/avgeek-oss/posted-api:latest";
    },
    (value) => {
      value.platforms = ["linux/arm64"];
    },
  ]) {
    const value = manifest();
    mutate(value);
    assert.throws(() => validateReleaseImages(value, "v0.1.0", commit));
  }
});
test("release CI gate accepts only the latest completed success for the exact source", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "posted-ci-gate-"));
  const file = resolve(dir, "checks.json");
  const check = (
    id,
    conclusion = "success",
    head_sha = commit,
    status = "completed",
  ) => ({
    id,
    name: "Required CI",
    head_sha,
    status,
    conclusion,
    started_at: `2026-10-14T00:00:0${id}Z`,
    app: { slug: "github-actions" },
  });
  const run = () =>
    execFileSync(
      process.execPath,
      ["tools/release-check.mjs", "--commit", commit, "--checks", file],
      { stdio: "pipe" },
    );
  try {
    await writeFile(file, JSON.stringify([{ check_runs: [check(1)] }]));
    assert.doesNotThrow(run);
    for (const checks of [
      [check(1), check(2, "failure")],
      [check(1), check(2, null, commit, "in_progress")],
      [check(1, "success", "d".repeat(40))],
    ]) {
      await writeFile(file, JSON.stringify([{ check_runs: checks }]));
      assert.throws(run);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
