import { sql } from "../../../../packages/database/src/index.js";
import type { PostMedia } from "../../../../packages/contracts/src/index.js";

const tables = {
  draft: {
    owner: "draft_id",
    overrides: "post_draft_media_overrides",
    media: "post_draft_account_media",
  },
  group: {
    owner: "group_id",
    overrides: "post_group_media_overrides",
    media: "post_group_account_media",
  },
} as const;
type Kind = keyof typeof tables;

export async function readAccountMedia(kind: Kind, id: string) {
  const table = tables[kind];
  const rows = await sql<
    (PostMedia & { postIndex: number; connectionId: string })[]
  >`
    SELECT o.post_index,o.connection_id,i.id,i.file_name,i.content_type,i.size_bytes,i.width,i.height,i.alt,i.duration_seconds
    FROM ${sql(table.overrides)} o
    LEFT JOIN ${sql(table.media)} m ON m.${sql(table.owner)}=o.${sql(table.owner)} AND m.post_index=o.post_index AND m.connection_id=o.connection_id
    LEFT JOIN post_media i ON i.id=m.media_id
    WHERE o.${sql(table.owner)}=${id} ORDER BY o.post_index,o.connection_id,m.position`;
  const parts = new Map<number, Record<string, PostMedia[]>>();
  for (const { postIndex, connectionId, ...media } of rows) {
    let overrides = parts.get(postIndex);
    if (!overrides) {
      overrides = {};
      parts.set(postIndex, overrides);
    }
    const items = (overrides[connectionId] ??= []);
    if (media.id) items.push(media);
  }
  return parts;
}

export async function saveAccountMedia(
  kind: Kind,
  id: string,
  workspaceId: string,
  parts: { mediaOverrides: Record<string, string[]> }[],
) {
  const table = tables[kind];
  await sql`DELETE FROM ${sql(table.overrides)} WHERE ${sql(table.owner)}=${id}`;
  for (const [postIndex, part] of parts.entries()) {
    for (const [connectionId, mediaIds] of Object.entries(
      part.mediaOverrides,
    )) {
      await sql`INSERT INTO ${sql(table.overrides)} (${sql(table.owner)},workspace_id,post_index,connection_id) VALUES(${id},${workspaceId},${postIndex},${connectionId})`;
      for (const [position, mediaId] of mediaIds.entries())
        await sql`INSERT INTO ${sql(table.media)} (${sql(table.owner)},workspace_id,post_index,connection_id,media_id,position) VALUES(${id},${workspaceId},${postIndex},${connectionId},${mediaId},${position})`;
    }
  }
}

export function allMediaIds(
  parts: { mediaIds: string[]; mediaOverrides: Record<string, string[]> }[],
) {
  return [
    ...new Set(
      parts.flatMap((part) => [
        ...part.mediaIds,
        ...Object.values(part.mediaOverrides).flat(),
      ]),
    ),
  ];
}

export function canonicalMediaOverrides(overrides: Record<string, string[]>) {
  return Object.keys(overrides).length
    ? {
        mediaOverrides: Object.fromEntries(
          Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b)),
        ),
      }
    : {};
}
