import type { Provider } from "./index.js";

export function profileImageUrl(provider: Provider, source: string | null) {
  if (provider !== "x" || !source || !URL.canParse(source)) return source;
  const url = new URL(source);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "pbs.twimg.com" ||
    !url.pathname.startsWith("/profile_images/")
  )
    return source;
  const pathname = url.pathname.replace(
    /_(normal|bigger|mini)(\.(?:jpe?g|png|gif|webp))$/i,
    "$2",
  );
  if (pathname === url.pathname) return source;
  url.pathname = pathname;
  return url.href;
}
