import twitterText from "twitter-text";

export function firstPostLink(text: string): string | null {
  const first = twitterText.extractUrlsWithIndices(text)[0]?.url;
  if (!first || first.length > 2048) return null;
  try {
    const url = new URL(
      /^https?:\/\//i.test(first) ? first : `https://${first}`,
    );
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export type LinkPreview = {
  url: string;
  title: string;
  description: string;
  siteName: string;
  image?: { data: string; width: number; height: number };
};
