import { z } from "zod";
import { postInput } from "../posts/input.js";
import { draftInput } from "../posts/drafts.js";
import { uploadInput } from "../media/input.js";
export type Tool = {
  name: string;
  description: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  input: z.ZodObject;
  readOnly: boolean;
  destructive?: boolean;
  workspaceWide?: boolean;
  admin?: boolean;
};
const id = z.uuid();
const page = {
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
};
function tool(
  name: string,
  description: string,
  method: Tool["method"],
  path: string,
  input: z.ZodObject,
  admin = false,
  destructive = false,
): Tool {
  return {
    name,
    description,
    method,
    path,
    input,
    admin,
    destructive,
    readOnly: method === "GET",
  };
}
export const tools: Tool[] = [
  tool(
    "list_drafts",
    "List team drafts. Drafts never enter the delivery queue.",
    "GET",
    "/api/drafts",
    z.object(page).strict(),
  ),
  tool(
    "get_draft",
    "Read a draft's text, selected accounts, overrides and ordered media.",
    "GET",
    "/api/drafts/:draftId",
    z.object({ draftId: id }).strict(),
  ),
  tool(
    "save_draft",
    "Save incomplete content without publishing. Use version 0 and a new draftId for a new draft, or its current version to update. Reuse the request key for retries.",
    "POST",
    "/api/drafts/:draftId",
    draftInput.safeExtend({ draftId: id }),
  ),
  tool(
    "delete_draft",
    "Delete a team draft using its current version. Ask the user before deleting their draft.",
    "DELETE",
    "/api/drafts/:draftId",
    z.object({ draftId: id, version: z.number().int().positive() }).strict(),
    false,
    true,
  ),
  tool(
    "list_connections",
    "List this team's connected social accounts. Credentials are never returned.",
    "GET",
    "/api/connections",
    z.object({}).strict(),
  ),
  tool(
    "list_providers",
    "Read enabled providers and their content limits.",
    "GET",
    "/api/providers",
    z.object({}).strict(),
  ),
  tool(
    "reserve_media_upload",
    "Reserve a private image or video upload. PUT the approved file to the returned URL using its headers, then complete the upload. No post is created.",
    "POST",
    "/api/media/uploads",
    uploadInput,
  ),
  tool(
    "complete_media_upload",
    "Validate uploaded media and queue video preparation. Read its status until ready before scheduling it.",
    "POST",
    "/api/media/:mediaId/complete",
    z.object({ mediaId: id }).strict(),
  ),
  tool(
    "get_media_status",
    "Read media preparation status and its metadata when ready.",
    "GET",
    "/api/media/:mediaId/status",
    z.object({ mediaId: id }).strict(),
  ),
  tool(
    "get_media_preview",
    "Get a short-lived private URL to view approved media.",
    "GET",
    "/api/media/:mediaId/preview",
    z.object({ mediaId: id }).strict(),
  ),
  tool(
    "list_posts",
    "List scheduled posts or post history with per-account delivery states.",
    "GET",
    "/api/posts",
    z
      .object({ view: z.enum(["scheduled", "history"]).optional(), ...page })
      .strict(),
  ),
  tool(
    "get_post",
    "Read a posting group, its media and individual account outcomes.",
    "GET",
    "/api/posts/:postId",
    z.object({ postId: id }).strict(),
  ),
  tool(
    "create_post",
    "Schedule or publish a post for selected team accounts. Confirm content, accounts and time with the user. Reuse the same idempotencyKey for retries.",
    "POST",
    "/api/posts",
    postInput,
  ),
  tool(
    "update_post",
    "Edit an entirely scheduled post using its current version. Publishing posts cannot be edited.",
    "PATCH",
    "/api/posts/:postId",
    postInput.safeExtend({ postId: id, version: z.number().int().positive() }),
  ),
  tool(
    "cancel_post",
    "Cancel pending deliveries. Ask the user before cancelling their post. Published posts remain in history.",
    "DELETE",
    "/api/posts/:postId",
    z.object({ postId: id }).strict(),
    false,
    true,
  ),
  tool(
    "disconnect_account",
    "Disconnect a team social account. Pending deliveries will fail. Ask the user before disconnecting.",
    "DELETE",
    "/api/connections/:connectionId",
    z.object({ connectionId: id }).strict(),
    true,
    true,
  ),
  tool(
    "get_team",
    "Read team settings.",
    "GET",
    "/api/workspace",
    z.object({}).strict(),
  ),
  tool(
    "update_team",
    "Update the team name.",
    "PATCH",
    "/api/workspace",
    z.object({ name: z.string().trim().min(1).max(120) }).strict(),
    true,
  ),
  tool(
    "list_members",
    "List team members within the current access role.",
    "GET",
    "/api/auth/members",
    z.object({ limit: z.number().int().min(1).max(1000).optional() }).strict(),
  ),
];
