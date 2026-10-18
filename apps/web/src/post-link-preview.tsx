import { useEffect, useState } from "react";
import {
  firstPostLink,
  type LinkPreview,
} from "../../../packages/contracts/src/links.js";
import { api } from "./api.js";

const previews = new Map<
  string,
  { expires: number; preview: LinkPreview | null }
>();
export function PostLinkPreview({ text }: { text: string }) {
  const url = firstPostLink(text);
  const [result, setResult] = useState<{
    url: string;
    preview: LinkPreview | null;
  } | null>(null);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const cached = previews.get(url);
      if (cached && cached.expires > Date.now()) {
        setResult({ url, preview: cached.preview });
        return;
      }
      try {
        const { preview } = await api<{ preview: LinkPreview | null }>(
          `/link-preview?url=${encodeURIComponent(url)}`,
          undefined,
          "GET",
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        previews.delete(url);
        previews.set(url, {
          expires: Date.now() + (preview ? 5 : 1) * 60_000,
          preview,
        });
        if (previews.size > 32) previews.delete(previews.keys().next().value!);
        setResult({ url, preview });
      } catch {
        // Unavailable metadata leaves the link in the post without a card.
      }
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [url]);
  const preview = result?.url === url ? result.preview : null;
  if (!preview) return null;
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-3 block overflow-hidden rounded-xl border border-separator text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
      aria-label={`Open ${preview.title}`}
    >
      {preview.image && (
        <img
          src={`data:image/jpeg;base64,${preview.image.data}`}
          width={preview.image.width}
          height={preview.image.height}
          alt=""
          loading="lazy"
          decoding="async"
          className="aspect-[1.91/1] w-full bg-default object-cover"
        />
      )}
      <div className="grid gap-1 p-3">
        <span className="truncate text-xs text-muted">{preview.siteName}</span>
        <span className="line-clamp-2 text-sm font-medium break-words">
          {preview.title}
        </span>
        {preview.description && (
          <span className="line-clamp-2 text-xs text-muted break-words">
            {preview.description}
          </span>
        )}
      </div>
    </a>
  );
}
