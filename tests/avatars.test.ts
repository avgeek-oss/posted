import assert from "node:assert/strict";
import { test } from "node:test";
import { profileImageUrl } from "../packages/contracts/src/avatars.js";

test("X profile thumbnails use the original image and retain URL parameters", () => {
  for (const size of ["normal", "bigger", "mini"]) {
    assert.equal(
      profileImageUrl(
        "x",
        `https://pbs.twimg.com/profile_images/123/avatar_${size}.jpg?version=2`,
      ),
      "https://pbs.twimg.com/profile_images/123/avatar.jpg?version=2",
    );
  }
  assert.equal(
    profileImageUrl(
      "x",
      "https://pbs.twimg.com/profile_images/123/avatar_normal.PNG",
    ),
    "https://pbs.twimg.com/profile_images/123/avatar.PNG",
  );
});

test("other image sources and existing full-size X images remain unchanged", () => {
  for (const source of [
    null,
    "invalid URL",
    "https://cdn.example.com/avatar_normal.png",
    "https://pbs.twimg.com.example.com/profile_images/123/avatar_normal.jpg",
    "https://pbs.twimg.com/media/avatar_normal.jpg",
    "https://pbs.twimg.com/profile_images/123/avatar.jpg",
    "https://pbs.twimg.com/profile_images/123/avatar_400x400.jpg",
    "https://pbs.twimg.com/profile_images/123/normal_name.jpg",
  ]) {
    assert.equal(profileImageUrl("x", source), source);
  }
  const source = "https://pbs.twimg.com/profile_images/123/avatar_normal.jpg";
  for (const provider of ["linkedin", "threads", "bluesky"] as const) {
    assert.equal(profileImageUrl(provider, source), source);
  }
});
