import { z } from "zod";
import {
  emailSchema,
  nameSchema,
  passwordSchema,
  dateFormatSchema,
  timeFormatSchema,
  timeZoneSchema,
} from "../apps/api/src/auth/model.js";
import {
  clientMetadataSchema,
  tokenLifetimeSeconds,
} from "../apps/api/src/external/protocol.js";

export const ids = {
  connection: "11111111-1111-4111-8111-111111111111",
  post: "22222222-2222-4222-8222-222222222222",
  draft: "33333333-3333-4333-8333-333333333333",
  media: "44444444-4444-4444-8444-444444444444",
  team: "55555555-5555-4555-8555-555555555555",
  user: "66666666-6666-4666-8666-666666666666",
};
const at = "2027-01-18T09:30:00.000Z";
const person = { id: ids.user, name: "Alex Morgan", avatarUrl: null };
export const exampleMedia = {
  id: ids.media,
  fileName: "studio.jpg",
  contentType: "image/jpeg",
  sizeBytes: 245760,
  width: 1600,
  height: 900,
  alt: "A bright studio desk beside a window",
  durationSeconds: null,
};
export const exampleConnection = {
  id: ids.connection,
  provider: "bluesky",
  accountId: "did:plc:example",
  name: "Alex Morgan",
  handle: "alex.example.test",
  avatarUrl: null,
  state: "connected",
  createdAt: at,
  connectedBy: person,
  lastPublished: null,
  scheduledCount: 1,
};
export const examplePost = {
  resumableConnectionIds: [],
  id: ids.post,
  text: "A small update from the studio.",
  additionalPosts: [],
  mediaOverrides: {},
  scheduledAt: at,
  idempotencyKey: "studio-update-2027-01-18",
  state: "scheduled",
  version: 1,
  createdAt: at,
  media: [exampleMedia],
  managedBy: person,
  deliveries: [
    {
      id: "77777777-7777-4777-8777-777777777777",
      postIndex: 0,
      connectionId: ids.connection,
      provider: "bluesky",
      accountName: "Alex Morgan",
      accountHandle: "alex.example.test",
      accountAvatarUrl: null,
      textOverride: null,
      state: "scheduled",
      attempts: 0,
      nextAttemptAt: null,
      providerPostId: null,
      publishedUrl: null,
      error: null,
      publishedAt: null,
    },
  ],
};
export const exampleDraft = {
  id: ids.draft,
  text: "An unfinished studio update.",
  additionalPosts: [],
  mediaOverrides: {},
  textOverrides: {},
  connectionIds: [ids.connection],
  connections: [
    {
      id: exampleConnection.id,
      provider: exampleConnection.provider,
      accountId: exampleConnection.accountId,
      name: exampleConnection.name,
      handle: exampleConnection.handle,
      avatarUrl: exampleConnection.avatarUrl,
      state: exampleConnection.state,
      createdAt: exampleConnection.createdAt,
    },
  ],
  media: [exampleMedia],
  version: 1,
  createdAt: at,
  updatedAt: at,
  draftedBy: person,
};
const workspace = { id: ids.team, name: "Studio team", createdAt: at };
const member = {
  id: ids.user,
  name: "Alex Morgan",
  email: "alex@example.test",
  role: "member",
  timeZone: "UTC",
  passkeyEnabled: false,
};
const identity = {
  user: {
    id: ids.user,
    name: member.name,
    email: member.email,
    role: member.role,
    timeZone: member.timeZone,
    emailVerified: true,
    dateFormat: "day-short-month-year",
    timeFormat: "24-hour",
    notificationPreferences: { assignments: true, mentions: true },
    passkeyCount: 0,
  },
  workspace,
};
const page = (item: unknown) => ({
  items: [item],
  total: 1,
  page: 1,
  pageSize: 20,
});
const postInput = {
  text: examplePost.text,
  connectionIds: [ids.connection],
  mediaIds: [ids.media],
  scheduledAt: at,
  idempotencyKey: examplePost.idempotencyKey,
};
export const illustrations: Record<
  string,
  {
    title: string;
    input: Record<string, unknown>;
    result: Record<string, unknown>;
    workflow: string[];
    note: string;
  }
> = {
  list_drafts: {
    title: "List drafts",
    input: { page: 1, pageSize: 20 },
    result: page(exampleDraft),
    workflow: [
      "Read pending drafts",
      "Choose a draft ID",
      "Read its current version",
    ],
    note: "Drafts are team-owned and never enter the delivery queue. Pagination is numbered and pageSize is at most 100.",
  },
  get_draft: {
    title: "Get a draft",
    input: { draftId: ids.draft },
    result: { draft: exampleDraft },
    workflow: [
      "Choose a draft",
      "Read text and account media",
      "Keep its current version",
    ],
    note: "Resolved media and mediaOverrides contain media objects. Saving uses mediaIds and mediaOverrides containing IDs.",
  },
  save_draft: {
    title: "Save a draft",
    input: {
      draftId: ids.draft,
      text: "An unfinished studio update.",
      connectionIds: [ids.connection],
      mediaIds: [ids.media],
      textOverrides: {},
      version: 0,
      idempotencyKey: "studio-draft-2027-01-18",
    },
    result: { draft: exampleDraft },
    workflow: [
      "Choose a new draft ID or read a draft",
      "Save with version and request key",
      "Keep the returned version",
    ],
    note: "Use version 0 for a new UUID, or the latest version for an update. Reuse the same idempotencyKey and identical content when retrying. Incomplete content is allowed. Saving does not publish.",
  },
  delete_draft: {
    title: "Delete a draft",
    input: { draftId: ids.draft, version: 1 },
    result: { completed: true },
    workflow: [
      "Read current draft",
      "Confirm deletion with the user",
      "Delete using that version",
    ],
    note: "Deletion removes the draft for the team. A stale version returns a conflict; read again before asking the user to confirm a new deletion.",
  },
  list_connections: {
    title: "List connections",
    input: {},
    result: { items: [exampleConnection] },
    workflow: [
      "Read team accounts",
      "Select connected account IDs",
      "Use them in a draft or post",
    ],
    note: "Credentials are never returned. Each account includes connection attribution, last confirmed publication and its pending-delivery count.",
  },
  list_providers: {
    title: "List providers",
    input: {},
    result: {
      providers: [
        {
          id: "bluesky",
          name: "Bluesky",
          maxCharacters: 300,
          maxImages: 4,
          maxVideos: 1,
          maxVideoDurationSeconds: 180,
          maxImageBytes: 2000000,
          maxImageDimension: 4000,
        },
      ],
    },
    workflow: [
      "Read enabled providers",
      "Inspect content limits",
      "Prepare compatible content",
    ],
    note: "Only fully configured providers appear. This returns Posted's enforced capabilities, not an assurance that a provider application has production approval.",
  },
  reserve_media_upload: {
    title: "Reserve a media upload",
    input: {
      fileName: exampleMedia.fileName,
      contentType: exampleMedia.contentType,
      sizeBytes: exampleMedia.sizeBytes,
      alt: exampleMedia.alt,
    },
    result: {
      mediaId: ids.media,
      uploadUrl: "https://storage.example.test/signed-upload",
      headers: { "Content-Type": "image/jpeg" },
    },
    workflow: [
      "Reserve the exact file type and byte size",
      "PUT bytes to the signed URL",
      "Complete the upload",
    ],
    note: "Use the returned uploadUrl and headers for the separate storage PUT. Reserving an upload does not create a post. Keep signed URLs private and use them before expiry.",
  },
  complete_media_upload: {
    title: "Complete a media upload",
    input: { mediaId: ids.media },
    result: { state: "ready", media: exampleMedia },
    workflow: [
      "Finish storage PUT",
      "Validate uploaded media",
      "Poll status if processing",
    ],
    note: "Images can become ready immediately. Videos normally return state processing with HTTP 202 and must finish preparation before a post can use them. Invalid bytes or size are rejected.",
  },
  get_media_status: {
    title: "Get media status",
    input: { mediaId: ids.media },
    result: { state: "ready", media: exampleMedia },
    workflow: [
      "Read media state",
      "Wait while processing",
      "Use the media ID when ready",
    ],
    note: "A processing result contains the state only. A ready result includes metadata. Failed media preparation returns an error instead of making media publishable.",
  },
  get_media_preview: {
    title: "Get a media preview",
    input: { mediaId: ids.media },
    result: { url: "https://storage.example.test/signed-preview" },
    workflow: [
      "Choose ready team media",
      "Request a short-lived URL",
      "Render privately before expiry",
    ],
    note: "Only approved, ready media from this team can be previewed. The URL is temporary and is not a permanent public attachment URL. Animated GIFs also return thumbnailUrl for a private still preview; open url to view the animation.",
  },
  list_posts: {
    title: "List posts",
    input: { view: "scheduled", page: 1, pageSize: 20 },
    result: page(examplePost),
    workflow: [
      "Choose scheduled or history",
      "Read a page of posting groups",
      "Inspect individual delivery results",
    ],
    note: "Scheduled includes groups with a scheduled, preparing or publishing delivery. History includes the remaining groups, including failed, uncertain and cancelled outcomes. It is not a list of confirmed publications alone.",
  },
  get_post: {
    title: "Get a post",
    input: { postId: ids.post },
    result: { post: examplePost },
    workflow: [
      "Choose a posting group",
      "Read each account and post index",
      "Decide whether action is safe",
    ],
    note: "The root and additionalPosts represent the ordered sequence. deliveries contains a separate state for every account and postIndex. A group can be partial even if some posts were published.",
  },
  create_post: {
    title: "Create a post",
    input: postInput,
    result: { post: examplePost },
    workflow: [
      "Confirm copy, accounts and time",
      "Create with one request key",
      "Inspect delivery state",
    ],
    note: "A future scheduledAt schedules delivery. For immediate publication, use the current timestamp after the user's confirmation. Creation acknowledges a queued request, not confirmed provider publication. Use draftSource with its current version when converting a saved draft.",
  },
  update_post: {
    title: "Update a scheduled post",
    input: {
      ...postInput,
      postId: ids.post,
      version: 1,
      idempotencyKey: "studio-edit-2027-01-18",
    },
    result: {
      post: {
        ...examplePost,
        version: 2,
        idempotencyKey: "studio-edit-2027-01-18",
      },
    },
    workflow: [
      "Read latest version",
      "Edit an entirely scheduled group",
      "Store the returned version",
    ],
    note: "Only entirely scheduled groups can be edited. A stale version conflicts instead of overwriting a teammate's change. Changes apply to the complete sequence and its account overrides.",
  },
  cancel_post: {
    title: "Cancel a post",
    input: { postId: ids.post },
    result: {
      post: {
        ...examplePost,
        state: "cancelled",
        deliveries: examplePost.deliveries.map((delivery) => ({
          ...delivery,
          state: "cancelled",
        })),
      },
    },
    workflow: [
      "Read current delivery states",
      "Confirm cancellation",
      "Inspect which deliveries were cancelled",
    ],
    note: "Cancellation stops pending deliveries. It does not remove provider-side publications, and a group with work already preparing or publishing cannot be cancelled safely.",
  },
  resume_post: {
    title: "Resume interrupted publishing",
    input: {
      postId: ids.post,
      connectionId: ids.connection,
      version: 1,
      idempotencyKey: "studio-resume-2027-01-18",
    },
    result: { post: { ...examplePost, version: 2 } },
    workflow: [
      "Read current outcomes and resumableConnectionIds",
      "Confirm the account and remaining content",
      "Resume with version and request key",
      "Inspect each delivery",
    ],
    note: "Resume one connected account's failed remainder without creating a new posting group. Confirmed posts, their IDs and original request key are preserved. Active, cancelled or uncertain sequences cannot be resumed. Reuse the same resume key and payload after a lost response. A new failure requires a new key and the latest group version.",
  },
  disconnect_account: {
    title: "Disconnect an account",
    input: { connectionId: ids.connection },
    result: { completed: true },
    workflow: [
      "Identify the exact team account",
      "Confirm disconnection",
      "Review affected pending deliveries",
    ],
    note: "Requires Administrator access. Scheduled deliveries for this account fail after disconnection. Previously published provider posts remain in place.",
  },
  get_team: {
    title: "Get team settings",
    input: {},
    result: { workspace },
    workflow: ["Read the current team", "Inspect its name and ID"],
    note: "Posted has one team per installation. The wire response calls this object workspace.",
  },
  update_team: {
    title: "Update team settings",
    input: { name: "Studio team" },
    result: { workspace },
    workflow: [
      "Confirm the team name",
      "Update team settings",
      "Read the saved name",
    ],
    note: "Requires Administrator access. This changes the team name, not membership or provider ownership.",
  },
  list_members: {
    title: "List members",
    input: { limit: 100 },
    result: { items: [member], hasMore: false, nextCursor: null },
    workflow: ["Read team members", "Inspect roles and passkey status"],
    note: "limit is at most 1000. The REST endpoint also supports a cursor; the MCP tool currently accepts limit only. A changed member collection can return a conflict.",
  },
};

export type Endpoint = {
  method: string;
  path: string;
  title: string;
  group: string;
  auth:
    | "public"
    | "session"
    | "recent"
    | "admin-session"
    | "read"
    | "write"
    | "admin"
    | "oauth-client"
    | "mcp";
  description: string;
  body?: z.ZodType;
  query?: z.ZodObject;
  result?: Record<string, unknown>;
  status?: number;
  form?: boolean;
  responseContentType?: "text/html";
};
const str = z.string();
const email = emailSchema;
const name = nameSchema;
const password = passwordSchema;
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const challenge = token;
const empty = z.object({}).strict();
const confirmation = z.object({ id: z.uuid(), token }).strict();
const role = z.enum(["admin", "member", "viewer"]);
const ok = { ok: true };
const receipt = { status: true };
const pending = { pending: { email: "new@example.test", expiresAt: at } };
const challengeResult = {
  challengeId: "example-challenge-token",
  options: {
    challenge: "example-browser-challenge",
    rpId: "posted.example.test",
    userVerification: "required",
  },
};
const endpoint = (
  method: string,
  path: string,
  title: string,
  group: string,
  auth: Endpoint["auth"],
  description: string,
  options: Partial<Endpoint> = {},
): Endpoint => ({ method, path, title, group, auth, description, ...options });
export const supplementalEndpoints: Endpoint[] = [
  endpoint(
    "GET",
    "/health/live",
    "API liveness",
    "Health",
    "public",
    "Checks that the API process responds. It does not verify database readiness.",
    { result: { status: "ok" } },
  ),
  endpoint(
    "GET",
    "/health/ready",
    "API readiness",
    "Health",
    "public",
    "Checks PostgreSQL connectivity and returns the running API version. An unavailable database returns HTTP 503.",
    { result: { status: "ready", version: "0.2.0" } },
  ),
  endpoint(
    "GET",
    "/api/auth/status",
    "Read installation status",
    "Account and sessions",
    "public",
    "Reports whether first-administrator setup is required and whether account email delivery is configured.",
    { result: { setupRequired: false, emailDeliveryConfigured: true } },
  ),
  endpoint(
    "POST",
    "/api/auth/setup",
    "Create the first administrator",
    "Account and sessions",
    "public",
    "Requires the unused installation setup secret. Creates the team and verified first administrator, then sets a session cookie. A configured installation rejects another setup.",
    {
      body: z
        .object({
          setupSecret: str.min(1).max(1024),
          workspaceName: name,
          name,
          email,
          password,
          dateFormat: dateFormatSchema.optional(),
          timeFormat: timeFormatSchema.optional(),
          timeZone: timeZoneSchema.optional(),
        })
        .strict(),
      result: { ...identity, user: { ...identity.user, role: "admin" } },
      status: 201,
    },
  ),
  endpoint(
    "POST",
    "/api/auth/login",
    "Sign in with a password",
    "Account and sessions",
    "public",
    "Sets a session cookie after password verification, or returns requiresSecondFactor, challengeId, methods, preferredMethod and recoveryAvailable when a passkey is required.",
    {
      body: z.object({ email, password: str.min(1).max(1024) }).strict(),
      result: identity,
    },
  ),
  endpoint(
    "POST",
    "/api/auth/reauth",
    "Verify a recent session",
    "Account and sessions",
    "session",
    "Reauthenticates the current session. A passkey-protected account receives a second-factor challenge before recent authentication is renewed.",
    { body: z.object({ password: str.min(1).max(1024) }).strict(), result: ok },
  ),
  endpoint(
    "POST",
    "/api/auth/logout",
    "Sign out",
    "Account and sessions",
    "public",
    "Deletes the supplied session if present and clears its cookie. Browser mutations carrying cookies require the trusted UI Origin.",
    { result: ok },
  ),
  endpoint(
    "GET",
    "/api/auth/me",
    "Read the signed-in account",
    "Account and sessions",
    "session",
    "Reads the current user, preferences and team. API keys and MCP credentials cannot impersonate this human session.",
    { result: identity },
  ),
  endpoint(
    "PATCH",
    "/api/auth/profile",
    "Update account preferences",
    "Account and sessions",
    "session",
    "Changes only supplied profile fields and returns the updated identity.",
    {
      body: z
        .object({
          name: name.optional(),
          timeZone: timeZoneSchema.optional(),
          dateFormat: dateFormatSchema.optional(),
          timeFormat: timeFormatSchema.optional(),
          notificationPreferences: z
            .object({ assignments: z.boolean(), mentions: z.boolean() })
            .strict()
            .optional(),
        })
        .strict(),
      result: identity,
    },
  ),
  endpoint(
    "GET",
    "/api/auth/sessions",
    "List account sessions",
    "Account and sessions",
    "session",
    "Lists unexpired sessions belonging to the signed-in user, including whether each session is current.",
    {
      result: {
        items: [
          {
            id: ids.user,
            userAgent: "Example browser",
            createdAt: at,
            lastSeenAt: at,
            expiresAt: at,
            current: true,
          },
        ],
      },
    },
  ),
  endpoint(
    "DELETE",
    "/api/auth/sessions/:id",
    "Revoke an account session",
    "Account and sessions",
    "session",
    "Revokes an owned session. Revoking the current session also clears its cookie.",
    { result: ok },
  ),
  endpoint(
    "POST",
    "/api/auth/password",
    "Change account password",
    "Account and sessions",
    "recent",
    "Verifies the current password, replaces it, invalidates other sessions and revokes human-owned credentials and pending authorizations.",
    {
      body: z
        .object({ currentPassword: str.min(1).max(1024), password })
        .strict(),
      result: ok,
    },
  ),
  endpoint(
    "POST",
    "/api/auth/passkeys/recovery/verify",
    "Use a passkey recovery code",
    "Passkeys and recovery",
    "public",
    "Consumes one recovery code against an active password-login challenge and creates a recovery-authenticated session.",
    {
      body: z
        .object({ challengeId: challenge, code: str.trim().min(1).max(100) })
        .strict(),
      result: identity,
    },
  ),
  endpoint(
    "POST",
    "/api/auth/passkeys/recovery-codes",
    "Replace passkey recovery codes",
    "Passkeys and recovery",
    "recent",
    "Requires a passkey verification within the last ten minutes and an existing passkey. Returns newly generated one-time codes; retain them privately.",
    { body: empty, result: { recoveryCodes: ["example-one-time-code"] } },
  ),
  endpoint(
    "GET",
    "/api/auth/passkeys",
    "List passkeys",
    "Passkeys and recovery",
    "session",
    "Lists the user's passkeys and remaining recovery-code count.",
    {
      result: {
        items: [
          {
            id: "example-webauthn-credential-id",
            name: "Studio laptop",
            createdAt: at,
          },
        ],
        recoveryCodeCount: 8,
      },
    },
  ),
  endpoint(
    "POST",
    "/api/auth/passkeys/register/options",
    "Begin passkey registration",
    "Passkeys and recovery",
    "recent",
    "Returns challengeId and WebAuthn creation options for a discoverable credential with user verification. At most twenty passkeys are allowed.",
    {
      result: {
        challengeId: "example-challenge-token",
        options: {
          challenge: "example-browser-challenge",
          rp: { name: "Posted", id: "posted.example.test" },
          user: {
            id: "ZXhhbXBsZS11c2VyLWlk",
            name: "alex@example.test",
            displayName: "Alex Morgan",
          },
          pubKeyCredParams: [{ alg: -7, type: "public-key" }],
          timeout: 60000,
          attestation: "none",
          excludeCredentials: [],
          authenticatorSelection: {
            residentKey: "required",
            requireResidentKey: true,
            userVerification: "required",
          },
        },
      },
    },
  ),
  endpoint(
    "POST",
    "/api/auth/passkeys/register/verify",
    "Complete passkey registration",
    "Passkeys and recovery",
    "recent",
    "Verifies the browser's RegistrationResponseJSON against the stored challenge, origin and RP ID. The first passkey also returns recoveryCodes.",
    {
      body: z
        .object({
          challengeId: challenge,
          response: z
            .record(str, z.unknown())
            .describe("WebAuthn RegistrationResponseJSON from the browser"),
          name,
        })
        .strict(),
      result: ok,
    },
  ),
  endpoint(
    "DELETE",
    "/api/auth/passkeys/:id",
    "Remove a passkey",
    "Passkeys and recovery",
    "recent",
    "Removes an owned WebAuthn credential. Removing the last passkey also removes its recovery codes. The path ID is the credential ID, not a UUID.",
    { result: ok },
  ),
  endpoint(
    "POST",
    "/api/auth/passkeys/authenticate/options",
    "Begin passkey authentication",
    "Passkeys and recovery",
    "public",
    "Returns challengeId and WebAuthn request options. Supply an active challengeId for password-login or reauthentication; a signed-in session without one starts reauthentication.",
    {
      body: z.object({ challengeId: challenge.optional() }).strict(),
      result: challengeResult,
    },
  ),
  endpoint(
    "POST",
    "/api/auth/passkeys/authenticate/verify",
    "Complete passkey authentication",
    "Passkeys and recovery",
    "public",
    "Verifies AuthenticationResponseJSON, consumes the challenge, and either creates a session or renews recent authentication.",
    {
      body: z
        .object({
          challengeId: challenge,
          response: z
            .record(str, z.unknown())
            .describe("WebAuthn AuthenticationResponseJSON from the browser"),
        })
        .strict(),
      result: identity,
    },
  ),
  endpoint(
    "POST",
    "/api/auth/recovery/reset",
    "Reset a password with a recovery token",
    "Passkeys and recovery",
    "public",
    "Consumes a valid email or operator recovery token and replaces the password. Existing sessions, human-owned credentials and pending authorizations are revoked. Operator recovery may also reset passkeys.",
    { body: z.object({ token, password }).strict(), result: ok },
  ),
  endpoint(
    "GET",
    "/api/auth/invitations",
    "List team invitations",
    "Members and invitations",
    "admin-session",
    "Lists active invitations with cursor pagination. Use nextCursor unchanged; a cursor from another team is rejected.",
    {
      query: z.object({
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.uuid().optional(),
      }),
      result: { items: [], hasMore: false, nextCursor: null },
    },
  ),
  endpoint(
    "POST",
    "/api/auth/invitations",
    "Invite a team member",
    "Members and invitations",
    "admin-session",
    "Creates an invitation and revokes older unused invitations for the same email. Returns its token and inviteUrl once, and queues email if SMTP is configured.",
    {
      body: z.object({ email, role }).strict(),
      result: {
        invitation: {
          id: ids.user,
          email: "sam@example.test",
          role: "member",
          createdAt: at,
          expiresAt: at,
        },
        token: "example-private-invitation-token",
        inviteUrl: "https://posted.example.test/invite?token=example",
        emailDelivery: "queued",
      },
      status: 201,
    },
  ),
  endpoint(
    "DELETE",
    "/api/auth/invitations/:id",
    "Revoke a team invitation",
    "Members and invitations",
    "admin-session",
    "Revokes an active unused invitation. The original inviter must still have administrator authority.",
    { result: ok },
  ),
  endpoint(
    "GET",
    "/api/auth/invitation",
    "Read an invitation",
    "Members and invitations",
    "public",
    "Looks up a valid invitation token without accepting it. Reports the team, invited email, role and whether email verification is required.",
    {
      query: z.object({ token }),
      result: {
        invitation: {
          email: "sam@example.test",
          role: "member",
          verificationRequired: true,
          workspaceName: "Studio team",
        },
        verificationRequired: true,
      },
    },
  ),
  endpoint(
    "POST",
    "/api/auth/accept-invitation",
    "Accept a team invitation",
    "Members and invitations",
    "public",
    "Creates or reactivates the invited account and sets its session. Supply verificationToken when this invitation requires email verification.",
    {
      body: z
        .object({ token, name, password, verificationToken: token.optional() })
        .strict(),
      result: identity,
      status: 201,
    },
  ),
  endpoint(
    "PATCH",
    "/api/auth/members/:id",
    "Change a member's role",
    "Members and invitations",
    "admin-session",
    "Changes the current role while protecting the last active administrator. A role change revokes that human's MCP grants.",
    { body: z.object({ role }).strict(), result: { member } },
  ),
  endpoint(
    "DELETE",
    "/api/auth/members/:id",
    "Remove a team member",
    "Members and invitations",
    "admin-session",
    "Disables the member and revokes their sessions, human-owned credentials and pending authorizations. The last administrator is protected.",
    { result: ok },
  ),
  endpoint(
    "POST",
    "/api/auth/email-verification/request",
    "Send account verification email",
    "Account email",
    "session",
    "Queues verification for the signed-in account. Requires SMTP. resendAvailableAt is an epoch timestamp in milliseconds. X-Posted-User-Id can guard against a changed signed-in identity.",
    { body: empty, result: { status: true, resendAvailableAt: 1800264660000 } },
  ),
  endpoint(
    "POST",
    "/api/auth/verification-email",
    "Request verification email by address",
    "Account email",
    "public",
    "Requests verification without disclosing whether the email is registered. Requires SMTP and is rate limited.",
    { body: z.object({ email }).strict(), result: receipt },
  ),
  endpoint(
    "POST",
    "/api/auth/password-reset/request",
    "Request a password-reset email",
    "Account email",
    "public",
    "Queues a reset email for an eligible account and always returns a generic receipt. Requires SMTP.",
    { body: z.object({ email }).strict(), result: receipt },
  ),
  endpoint(
    "POST",
    "/api/auth/email-verification/confirm",
    "Confirm account email",
    "Account email",
    "public",
    "Consumes the id and token from a valid verification link.",
    { body: confirmation, result: ok },
  ),
  endpoint(
    "GET",
    "/api/auth/email-change",
    "Read pending email change",
    "Account email",
    "session",
    "Returns the current pending email change or pending null.",
    { result: pending },
  ),
  endpoint(
    "POST",
    "/api/auth/email-change",
    "Request an email change",
    "Account email",
    "recent",
    "Queues verification to a new email address and returns the pending request. The email must be available and SMTP configured.",
    { body: z.object({ email }).strict(), result: pending },
  ),
  endpoint(
    "DELETE",
    "/api/auth/email-change",
    "Cancel a pending email change",
    "Account email",
    "session",
    "Cancels pending email changes and their unsent account emails.",
    { body: empty, result: ok },
  ),
  endpoint(
    "POST",
    "/api/auth/email-change/confirm",
    "Confirm an email change",
    "Account email",
    "public",
    "Consumes the link, verifies the new email, and revokes sessions and human-owned credentials. Sign in again afterward.",
    { body: confirmation, result: ok },
  ),
  endpoint(
    "POST",
    "/api/auth/invitation/verification/request",
    "Send invitation verification code",
    "Account email",
    "public",
    "Sends a six-digit code for an invitation requiring verification. Returns expiry and the earliest resend time.",
    {
      body: z.object({ token }).strict(),
      result: { status: true, resendAvailableAt: 1800264660000, expiresAt: at },
    },
  ),
  endpoint(
    "POST",
    "/api/auth/invitation/verification/confirm",
    "Verify an invitation code",
    "Account email",
    "public",
    "Checks the code and binds the returned verificationToken to the exact invited name. Supply that proof when accepting the invitation.",
    {
      body: z.object({ token, name, code: str.regex(/^\d{6}$/) }).strict(),
      result: { verificationToken: "example-private-verification-token" },
    },
  ),
  endpoint(
    "GET",
    "/api/posts/counts",
    "Count scheduled posts and drafts",
    "Posts",
    "read",
    "Returns team-wide group counts for the sidebar, independent of list pagination.",
    { result: { scheduled: 2, drafts: 4 } },
  ),
  endpoint(
    "GET",
    "/api/link-preview",
    "Preview a link",
    "Media",
    "read",
    "Reads the first link's Open Graph or page metadata for a composer card. Only public HTTP destinations are fetched. Returns null when metadata is unavailable. Images are bounded, re-encoded JPEG data in base64; no remote image URL is exposed.",
    {
      query: z.object({ url: z.url().max(2048) }),
      result: {
        preview: {
          url: "https://example.com/story",
          title: "A story",
          description: "Read the full story.",
          siteName: "Example",
        },
      },
    },
  ),
  endpoint(
    "GET",
    "/api/media/config",
    "Read media upload configuration",
    "Media",
    "read",
    "Reports whether private storage is enabled, supported MIME types and maximum upload sizes. Provider delivery limits can be lower.",
    {
      result: {
        enabled: true,
        maxBytes: 104857600,
        maxImageBytes: 20971520,
        contentTypes: [
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/gif",
          "video/mp4",
          "video/quicktime",
        ],
      },
    },
  ),
  endpoint(
    "POST",
    "/api/social/connect/:provider",
    "Begin a social account connection",
    "Social connections",
    "admin",
    "Creates OAuth state and PKCE material and returns the provider authorization URL. Bluesky requires a valid handle; complete authorization in the provider browser flow.",
    {
      body: z.object({ handle: str.trim().max(253).optional() }).strict(),
      result: {
        authorizationUrl:
          "https://provider.example.test/authorize?state=example",
      },
    },
  ),
  endpoint(
    "GET",
    "/api/social/linkedin-pages/authorizations/:id",
    "List Pages available to connect",
    "Social connections",
    "admin-session",
    "Returns the Pages discovered during this administrator's LinkedIn Pages OAuth flow. Grants expire after ten minutes. Provider credentials are never returned.",
    {
      result: {
        pages: [
          {
            accountId: "123456",
            name: "Studio North",
            handle: "studio-north",
            avatarUrl: null,
          },
        ],
      },
    },
  ),
  endpoint(
    "POST",
    "/api/social/linkedin-pages/authorizations/:id",
    "Connect selected LinkedIn Pages",
    "Social connections",
    "admin-session",
    "Rechecks current Page access and connects only the selected Page IDs to the team. Consumes the pending authorization atomically; repeated requests cannot create duplicate connections.",
    {
      body: z
        .object({
          accountIds: z
            .array(z.string().regex(/^[0-9]+$/))
            .min(1)
            .max(2000),
        })
        .strict(),
      result: { connected: 1 },
    },
  ),
  endpoint(
    "DELETE",
    "/api/social/linkedin-pages/authorizations/:id",
    "Cancel LinkedIn Page selection",
    "Social connections",
    "admin-session",
    "Discards this administrator's pending authorization without saving or removing any team connections.",
    { result: { cancelled: true } },
  ),
  endpoint(
    "GET",
    "/api/social/callback/:provider",
    "Complete a social OAuth callback",
    "Social connections",
    "session",
    "Provider callback handler. Verifies the stored state, verifier, initiating user and provider, saves encrypted tokens, then redirects to Posted. Do not fabricate callbacks or log authorization codes.",
    {
      query: z.object({
        state: str.optional(),
        code: str.optional(),
        error: str.optional(),
        iss: str.optional(),
      }),
      status: 302,
    },
  ),
  endpoint(
    "POST",
    "/api/social/threads/deauthorize",
    "Receive a Threads uninstall notification",
    "Social connections",
    "public",
    "Meta sends a form-encoded signed_request verified with the configured Threads app secret. Disconnects only the matching Threads account, clears its credentials and cancels scheduled or preparing deliveries. Repeated events are idempotent. A request already publishing cannot be recalled. Browser sessions and API keys do not authorize this callback.",
    {
      body: z.object({ signed_request: str }),
      form: true,
      result: { success: true },
    },
  ),
  endpoint(
    "POST",
    "/api/social/threads/data-deletion",
    "Receive a Threads data deletion request",
    "Social connections",
    "public",
    "Meta sends a form-encoded signed_request verified with the configured Threads app secret. Removes the matching Threads connection, credentials, profile and delivery records in one transaction. Team-authored master copy, uploaded originals, human users and other providers remain. Returns a private confirmation link; repeated events return the same receipt. This does not delete posts on Threads or recall an in-flight publish.",
    {
      body: z.object({ signed_request: str }),
      form: true,
      result: {
        url: "https://posted-api.example.com/api/social/threads/data-deletion/0123456789abcdef0123456789abcdef0123456789abcdef",
        confirmation_code: "0123456789abcdef0123456789abcdef0123456789abcdef",
      },
    },
  ),
  endpoint(
    "GET",
    "/api/social/threads/data-deletion/:code",
    "Check a Threads deletion receipt",
    "Social connections",
    "public",
    "Returns a human-readable HTML completion receipt for an unguessable 48-character confirmation code. Does not show an account identifier, name, handle, token or post content. Unknown codes return 404. Keep the receipt link private.",
    { responseContentType: "text/html" },
  ),
  endpoint(
    "GET",
    "/social/bluesky/client-metadata.json",
    "Read Bluesky client metadata",
    "Social connections",
    "public",
    "Serves the configured public OAuth client metadata. Returns 404 when Bluesky is not configured.",
    {
      result: {
        client_id:
          "https://posted-api.example.test/social/bluesky/client-metadata.json",
        client_name: "Posted",
        application_type: "web",
        token_endpoint_auth_method: "private_key_jwt",
      },
    },
  ),
  endpoint(
    "GET",
    "/social/bluesky/jwks.json",
    "Read Bluesky public signing keys",
    "Social connections",
    "public",
    "Serves public signing keys only. The private P-256 signing key is never returned. Returns 404 when Bluesky is disabled.",
    {
      result: {
        keys: [
          {
            kty: "EC",
            crv: "P-256",
            kid: "posted-1",
            x: "example-public-x",
            y: "example-public-y",
          },
        ],
      },
    },
  ),
];
for (const scope of ["personal", "team"] as const) {
  const path =
    scope === "personal" ? "/api/credentials" : "/api/team-credentials";
  const auth = scope === "personal" ? "session" : "admin-session";
  supplementalEndpoints.push(
    endpoint(
      "GET",
      path,
      `List ${scope} API keys and MCP grants`,
      "API key management",
      auth,
      "Returns credential metadata without bearer secrets. Uses a UUID cursor and a maximum limit of 200.",
      {
        query: z.object({
          limit: z.number().int().min(1).max(200).optional(),
          cursor: z.uuid().optional(),
        }),
        result: { items: [], hasMore: false, nextCursor: null },
      },
    ),
    endpoint(
      "POST",
      path,
      `Create a ${scope} API key`,
      "API key management",
      scope === "personal" ? "recent" : auth,
      "Requires recent authentication. Returns the new bearer secret once. Read access cannot mutate; includeAdmin requests administrative operations within the actor's authority.",
      {
        body: z
          .object({
            name,
            access: z.enum(["read", "edit"]),
            includeAdmin: z.boolean(),
            expiresAt: z.iso.datetime().nullable(),
          })
          .strict(),
        result: {
          credential: {
            id: ids.user,
            name: "Studio assistant",
            accessLevel: "read",
            includeAdmin: false,
            tokenType: "api-key",
            tokenPrefix: "pst_example",
            createdAt: at,
            expiresAt: null,
            revokedAt: null,
          },
          token: "example-private-key-returned-once",
        },
        status: 201,
      },
    ),
    endpoint(
      "DELETE",
      `${path}/:id`,
      `Revoke a ${scope} API key or MCP grant`,
      "API key management",
      auth,
      "Revokes an owned credential. Team revocation also requires recent authentication; subsequent requests cannot use the revoked key or grant.",
      { result: { revoked: true } },
    ),
  );
}
const oauthForm = z.object({
  client_id: str.optional(),
  client_secret: str.optional(),
});
supplementalEndpoints.push(
  endpoint(
    "GET",
    "/.well-known/oauth-authorization-server",
    "OAuth authorization-server metadata",
    "OAuth and MCP transport",
    "public",
    "Advertises authorization, token, registration, revocation, S256 PKCE and user-selected read/write/admin capabilities.",
    {
      result: {
        issuer: "https://posted-api.example.test",
        authorization_endpoint:
          "https://posted-api.example.test/oauth/authorize",
        token_endpoint: "https://posted-api.example.test/oauth/token",
      },
    },
  ),
  ...[
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ].map((path) =>
    endpoint(
      "GET",
      path,
      path.endsWith("/mcp")
        ? "MCP protected-resource metadata"
        : "Protected-resource metadata",
      "OAuth and MCP transport",
      "public",
      "Advertises the MCP resource and its authorization server. Use HTTPS for public installations.",
      {
        result: {
          resource: "https://posted-api.example.test/mcp",
          authorization_servers: ["https://posted-api.example.test"],
          scopes_supported: ["read", "write", "admin"],
          bearer_methods_supported: ["header"],
          resource_name: "Posted MCP",
        },
      },
    ),
  ),
  endpoint(
    "POST",
    "/oauth/register",
    "Register an OAuth client",
    "OAuth and MCP transport",
    "public",
    "Registers a client with validated redirect URIs. The returned client_secret is present only for a confidential client; retain it privately.",
    {
      body: clientMetadataSchema,
      result: {
        client_id: ids.user,
        client_name: "Studio assistant",
        redirect_uris: ["https://client.example.test/callback"],
        token_endpoint_auth_method: "none",
      },
      status: 201,
    },
  ),
  endpoint(
    "GET",
    "/oauth/authorize",
    "Begin MCP OAuth authorization",
    "OAuth and MCP transport",
    "public",
    "Validates the client, exact redirect URI, MCP resource and S256 PKCE challenge, then redirects to Posted's human consent flow. The human chooses the access level.",
    {
      query: z.object({
        response_type: z.literal("code"),
        client_id: str,
        redirect_uri: z.url(),
        code_challenge: str,
        code_challenge_method: z.literal("S256"),
        resource: z.url(),
        state: str.optional(),
        scope: str.optional(),
      }),
      status: 302,
    },
  ),
  endpoint(
    "GET",
    "/api/oauth/consent/:id",
    "Read an MCP consent request",
    "OAuth and MCP transport",
    "session",
    "Reads the client and requested authorization for the signed-in human's approval screen.",
    {
      result: {
        clientName: "Studio assistant",
        clientId: "example-client-id",
        clientTrust: "unverified",
        redirectUri: "https://client.example.test/callback",
        scope: "read",
        expiresIn: tokenLifetimeSeconds,
        user: { name: "Alex Morgan", role: "member" },
        availableAccessLevels: ["read", "write"],
        canApprove: true,
      },
    },
  ),
  endpoint(
    "POST",
    "/api/oauth/consent/:id",
    "Approve or deny MCP consent",
    "OAuth and MCP transport",
    "session",
    "The human selects accessLevel. Approval requires recent authentication. When allow is false, omit accessLevel. A client cannot select or approve its own permissions.",
    {
      body: z
        .object({
          allow: z.boolean(),
          accessLevel: z.enum(["read", "write", "admin"]).optional(),
        })
        .strict(),
      result: {
        redirectTo:
          "https://client.example.test/callback?code=example&state=example",
      },
    },
  ),
  endpoint(
    "POST",
    "/oauth/token",
    "Exchange an OAuth authorization code",
    "OAuth and MCP transport",
    "oauth-client",
    "Uses an authorization code once with the original redirect URI, MCP resource and PKCE verifier. This server does not issue refresh tokens. Client authentication follows the registered method.",
    {
      body: oauthForm.extend({
        grant_type: z.literal("authorization_code"),
        code: str,
        redirect_uri: z.url(),
        code_verifier: str,
        resource: z.url(),
      }),
      form: true,
      result: {
        access_token: "example-private-oauth-token",
        token_type: "Bearer",
        expires_in: tokenLifetimeSeconds,
        scope: "read",
      },
    },
  ),
  endpoint(
    "POST",
    "/oauth/revoke",
    "Revoke an OAuth token",
    "OAuth and MCP transport",
    "oauth-client",
    "Revokes a token for the authenticated OAuth client. A successful response has an empty body.",
    {
      body: oauthForm.extend({ token: str, token_type_hint: str.optional() }),
      form: true,
    },
  ),
  endpoint(
    "POST",
    "/mcp",
    "Call the MCP transport",
    "OAuth and MCP transport",
    "mcp",
    "Streamable HTTP JSON-RPC endpoint. Use an MCP SDK for initialization, tools/list and tools/call. A static REST API key cannot authorize this transport.",
    {
      body: z.object({
        jsonrpc: z.literal("2.0"),
        id: z.union([str, z.number()]).optional(),
        method: str,
        params: z.record(str, z.unknown()).optional(),
      }),
      result: { jsonrpc: "2.0", id: 1, result: { tools: [] } },
    },
  ),
  endpoint(
    "GET",
    "/mcp",
    "MCP streaming request",
    "OAuth and MCP transport",
    "mcp",
    "The SDK accepts a GET with Accept: text/event-stream. Posted closes the per-request server after the response is created and does not provide a persistent event session. Use POST JSON-RPC for normal tool calls. Missing the SSE Accept type returns HTTP 406.",
    {},
  ),
  endpoint(
    "DELETE",
    "/mcp",
    "MCP session termination request",
    "OAuth and MCP transport",
    "mcp",
    "Accepts transport termination with an empty HTTP 200 response. Posted allocates no persistent MCP session, so this does not revoke the OAuth grant. Revoke the grant in account settings or through the OAuth revocation endpoint.",
    {},
  ),
);
