import type {
  DeliveryState,
  PostState,
} from "../../../../packages/contracts/src/index.js";

export function postState(states: readonly DeliveryState[]): PostState {
  if (!states.length) throw new Error("A post requires at least one delivery");
  if (states.some((state) => state === "preparing" || state === "publishing"))
    return "publishing";
  if (states.some((state) => state === "scheduled")) return "scheduled";
  if (states.every((state) => state === "published")) return "published";
  if (states.every((state) => state === "cancelled")) return "cancelled";
  if (states.some((state) => state === "uncertain")) return "uncertain";
  if (states.some((state) => state === "published")) return "partial";
  return "failed";
}
