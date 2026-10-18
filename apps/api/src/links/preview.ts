import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { Parser } from "htmlparser2";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import type { LinkPreview } from "../../../../packages/contracts/src/links.js";

const htmlLimit = 512 * 1024;
const imageLimit = 4 * 1024 * 1024;
const cache = new Map<
  string,
  { expires: number; preview: LinkPreview | null }
>();
const pending = new Map<string, Promise<LinkPreview | null>>();

export function publicLink(value: string) {
  if (value.length > 2048) throw new Error("Link is too long");
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error("Only public HTTP links are supported");
  url.hash = "";
  return url;
}
export function publicAddress(address: string) {
  try {
    const parsed = ipaddr.process(address);
    return (
      parsed.range() === "unicast" &&
      (parsed.kind() === "ipv4" || parsed.match(ipaddr.parseCIDR("2000::/3")))
    );
  } catch {
    return false;
  }
}
async function resolveAddress(url: URL, signal: AbortSignal) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await new Promise<{ address: string; family: number }[]>(
        (resolve, reject) => {
          const aborted = () => reject(new Error("Link lookup timed out"));
          signal.addEventListener("abort", aborted, { once: true });
          dns
            .lookup(hostname, { all: true, verbatim: true })
            .then(resolve, reject)
            .finally(() => signal.removeEventListener("abort", aborted));
        },
      );
  signal.throwIfAborted();
  if (
    !addresses.length ||
    addresses.some(({ address }) => !publicAddress(address))
  )
    throw new Error("Link destination is not public");
  return addresses[0]!;
}
async function download(
  value: string,
  image: boolean,
  signal: AbortSignal,
  redirects = 0,
): Promise<{ bytes: Buffer; url: URL; contentType: string }> {
  const url = publicLink(value);
  const address = await resolveAddress(url, signal);
  const result = await new Promise<{
    bytes: Buffer;
    location?: string;
    contentType: string;
  }>((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(
      url,
      {
        agent: false,
        family: address.family,
        lookup: (_hostname, _options, callback) =>
          callback(null, address.address, address.family),
        signal,
        maxHeaderSize: 16 * 1024,
        headers: {
          "User-Agent": "Posted-Link-Preview/1.0",
          Accept: image
            ? "image/jpeg,image/png,image/webp,image/gif"
            : "text/html,application/xhtml+xml",
          "Accept-Encoding": "identity",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (
          [301, 302, 303, 307, 308].includes(status) &&
          response.headers.location
        ) {
          response.destroy();
          resolve({
            bytes: Buffer.alloc(0),
            location: response.headers.location,
            contentType: "",
          });
          return;
        }
        const contentType = String(response.headers["content-type"] ?? "")
          .split(";")[0]!
          .trim()
          .toLowerCase();
        if (
          status !== 200 ||
          (response.headers["content-encoding"] &&
            response.headers["content-encoding"] !== "identity") ||
          (!image &&
            !["text/html", "application/xhtml+xml"].includes(contentType))
        ) {
          response.destroy();
          reject(new Error("Link response is not supported"));
          return;
        }
        const limit = image ? imageLimit : htmlLimit;
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          const remaining = limit - size;
          chunks.push(chunk.subarray(0, remaining));
          size += chunk.length;
          if (size > limit) {
            if (image) reject(new Error("Link image is too large"));
            else resolve({ bytes: Buffer.concat(chunks), contentType });
            response.destroy();
          }
        });
        response.on("end", () =>
          resolve({ bytes: Buffer.concat(chunks), contentType }),
        );
        response.on("error", reject);
        response.on("aborted", () =>
          reject(new Error("Link response was interrupted")),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
  if (result.location) {
    if (redirects >= 3) throw new Error("Too many link redirects");
    return download(
      new URL(result.location, url).href,
      image,
      signal,
      redirects + 1,
    );
  }
  return { ...result, url };
}
export function linkMetadata(html: string) {
  const tags = new Map<string, string>();
  let title = "";
  let inTitle = false;
  let headEnded = false;
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (name === "body") headEnded = true;
        if (headEnded) return;
        inTitle = name === "title";
        if (name === "meta") {
          const key = (
            attributes.property ??
            attributes.name ??
            ""
          ).toLowerCase();
          if (attributes.content && !tags.has(key))
            tags.set(key, attributes.content);
        }
      },
      ontext(value) {
        if (inTitle && !headEnded) title += value;
      },
      onclosetag(name) {
        if (name === "head") headEnded = true;
        if (name === "title") inTitle = false;
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  const clean = (value: string, limit: number) =>
    value
      .replace(/\p{Cc}/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit);
  return {
    title: clean(
      tags.get("og:title") ?? tags.get("twitter:title") ?? title,
      300,
    ),
    description: clean(
      tags.get("og:description") ??
        tags.get("twitter:description") ??
        tags.get("description") ??
        "",
      600,
    ),
    siteName: clean(tags.get("og:site_name") ?? "", 100),
    image:
      tags.get("og:image:secure_url") ??
      tags.get("og:image") ??
      tags.get("og:image:url") ??
      tags.get("twitter:image") ??
      tags.get("twitter:image:src"),
  };
}
async function previewImage(
  value: string,
  base: URL,
): Promise<LinkPreview["image"]> {
  try {
    const result = await download(
      new URL(value, base).href,
      true,
      AbortSignal.timeout(5000),
    );
    const type = await fileTypeFromBuffer(result.bytes);
    if (
      !type ||
      !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
        type.mime,
      )
    )
      return;
    const { data, info } = await sharp(result.bytes, {
      limitInputPixels: 20_000_000,
      pages: 1,
    })
      .rotate()
      .resize({
        width: 1200,
        height: 630,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 75 })
      .toBuffer({ resolveWithObject: true });
    if (data.length > 200 * 1024) return;
    return {
      data: data.toString("base64"),
      width: info.width,
      height: info.height,
    };
  } catch {
    return;
  }
}
async function fetchPreview(url: URL): Promise<LinkPreview | null> {
  try {
    const page = await download(url.href, false, AbortSignal.timeout(5000));
    const metadata = linkMetadata(page.bytes.toString("utf8"));
    if (!metadata.title && !metadata.image) return null;
    const image = metadata.image
      ? await previewImage(metadata.image, page.url)
      : undefined;
    return {
      url: url.href,
      title: metadata.title || page.url.hostname,
      description: metadata.description,
      siteName: metadata.siteName || page.url.hostname,
      ...(image ? { image } : {}),
    };
  } catch {
    // A missing link card must not prevent publishing the original text.
    return null;
  }
}
export async function getLinkPreview(
  value: string,
): Promise<LinkPreview | null> {
  let url: URL;
  try {
    url = publicLink(value);
  } catch {
    return null;
  }
  const cached = cache.get(url.href);
  if (cached && cached.expires > Date.now()) return cached.preview;
  const existing = pending.get(url.href);
  if (existing) return existing;
  if (pending.size >= 8) return null;
  const task = fetchPreview(url)
    .then((preview) => {
      cache.delete(url.href);
      cache.set(url.href, {
        expires: Date.now() + (preview ? 10 : 1) * 60_000,
        preview,
      });
      if (cache.size > 48) cache.delete(cache.keys().next().value!);
      return preview;
    })
    .finally(() => pending.delete(url.href));
  pending.set(url.href, task);
  return task;
}
