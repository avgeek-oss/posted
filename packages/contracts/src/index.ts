export type Role = "admin" | "member" | "viewer";
export type Actor = {
  userId: string;
  name: string;
  role: Role;
  kind: "human" | "oauth" | "team";
  scopes: string[];
  includeAdmin?: boolean;
  credentialId?: string;
  credentialType?: "api-key" | "oauth";
};
export type Member = {
  id: string;
  name: string;
  email: string;
  role: Role;
  timeZone: string;
  passkeyEnabled: boolean;
};
export type AuthStatus = {
  setupRequired: boolean;
  emailDeliveryConfigured: boolean;
};
export type UserEmailState = {
  email: string;
  emailVerified: boolean;
};
export type PendingEmailChange = {
  email: string;
  expiresAt: string;
};
export type EmailRequestReceipt = { status: true };
export type EmailResendReceipt = EmailRequestReceipt & {
  resendAvailableAt: number;
};
export type InvitationCodeReceipt = EmailResendReceipt & {
  expiresAt: string;
};
export type InvitationVerificationProof = { verificationToken: string };

export const PROVIDERS = [
  "x",
  "linkedin",
  "linkedin-pages",
  "facebook-pages",
  "instagram",
  "bluesky",
  "threads",
] as const;
export type Provider = (typeof PROVIDERS)[number];
export type ProviderCapabilities = {
  id: Provider;
  name: string;
  maxCharacters: number;
  maxImages: number;
  maxVideos: number;
  maxVideoDurationSeconds: number;
  maxImageBytes: number;
  maxImageDimension: number;
};
export type SocialConnection = {
  id: string;
  provider: Provider;
  accountId: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  state: "connected" | "reauthentication_required" | "disconnected";
  createdAt: string;
};
export type SocialConnectionSummary = SocialConnection & {
  connectedBy: { id: string; name: string; avatarUrl: string } | null;
  lastPublished: { postId: string; publishedAt: string } | null;
  scheduledCount: number;
};
export const DELIVERY_STATES = [
  "scheduled",
  "preparing",
  "publishing",
  "published",
  "failed",
  "uncertain",
  "cancelled",
] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];
export type PostState =
  | "scheduled"
  | "publishing"
  | "published"
  | "partial"
  | "failed"
  | "uncertain"
  | "cancelled";
export type PostMedia = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
  alt: string;
  durationSeconds: number | null;
};
export type PostDelivery = {
  attempts: number;
  nextAttemptAt: string | null;
  postIndex: number;
  id: string;
  connectionId: string;
  provider: Provider;
  accountName: string;
  accountHandle: string;
  accountAvatarUrl: string | null;
  textOverride: string | null;
  state: DeliveryState;
  providerPostId: string | null;
  publishedUrl: string | null;
  error: string | null;
  publishedAt: string | null;
};
export type Post = {
  resumableConnectionIds: string[];
  mediaOverrides: Record<string, PostMedia[]>;
  additionalPosts: PostPart[];
  id: string;
  text: string;
  scheduledAt: string;
  idempotencyKey: string;
  state: PostState;
  version: number;
  createdAt: string;
  media: PostMedia[];
  deliveries: PostDelivery[];
  managedBy: { id: string; name: string; avatarUrl: string } | null;
};
export type PostPartInput = {
  mediaOverrides?: Record<string, string[]>;
  text: string;
  textOverrides?: Record<string, string>;
  mediaIds: string[];
};
export type PostPart = {
  mediaOverrides: Record<string, PostMedia[]>;
  text: string;
  textOverrides: Record<string, string>;
  media: PostMedia[];
};
export type PostInput = {
  mediaOverrides?: Record<string, string[]>;
  additionalPosts?: PostPartInput[];
  text: string;
  textOverrides?: Record<string, string>;
  connectionIds: string[];
  mediaIds: string[];
  scheduledAt: string;
  idempotencyKey: string;
  draftSource?: { id: string; version: number };
};
export type DraftInput = {
  mediaOverrides?: Record<string, string[]>;
  additionalPosts?: PostPartInput[];
  text: string;
  textOverrides: Record<string, string>;
  connectionIds: string[];
  mediaIds: string[];
  version: number;
  idempotencyKey: string;
};
export type PostDraft = {
  mediaOverrides: Record<string, PostMedia[]>;
  additionalPosts: PostPart[];
  id: string;
  text: string;
  textOverrides: Record<string, string>;
  connectionIds: string[];
  connections: SocialConnection[];
  media: PostMedia[];
  version: number;
  createdAt: string;
  updatedAt: string;
  draftedBy: Post["managedBy"];
};
export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type PostCounts = { scheduled: number; drafts: number };

export type SocialPage = {
  accountId: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
};

export type LinkedInPage = SocialPage;
export type FacebookPage = SocialPage;
