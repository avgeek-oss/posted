import {
  createMetaCallbackRoutes,
  metaSubjectHash,
  checkMetaAuthorization,
} from "./meta-callbacks.js";
export const threadsCallbackRoutes = createMetaCallbackRoutes("threads");
export const threadsSubjectHash = (accountId: string) =>
  metaSubjectHash("threads", accountId);
export const checkThreadsAuthorization = (
  accountId: string,
  stateHash: string,
) => checkMetaAuthorization("threads", accountId, stateHash);
