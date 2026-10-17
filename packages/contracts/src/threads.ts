import type { Provider } from "./index.js";

export function supportsThreads(provider: Provider) {
  return provider === "x" || provider === "bluesky" || provider === "threads";
}
