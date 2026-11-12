export function optimizeImageUrl(url: string | null | undefined, width = 800): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }

  const host = parsed.hostname.toLowerCase();

  // Wikimedia Commons: prefer a thumbnail variant over the full-resolution file.
  if (host === "upload.wikimedia.org" || host === "thumb.wikimedia.org") {
    // Wikimedia only serves a fixed set of thumbnail widths; requesting an
    // arbitrary size (e.g. 800px) can 400. Keep the original URL so images render.
    return trimmed;
  }

  // Unsplash: request a sized, auto-formatted variant.
  if (host === "images.unsplash.com") {
    const params = new URLSearchParams(parsed.search);
    params.set("w", String(width));
    if (!params.has("q")) params.set("q", "80");
    params.set("auto", "format");
    params.set("fit", "crop");
    return `${parsed.origin}${parsed.pathname}?${params.toString()}${parsed.hash}`;
  }

  // Google Places photo redirect URLs already carry a size; bump only if present.
  if (host === "places.googleapis.com") {
    return trimmed.replace(/maxWidthPx=\d+/i, `maxWidthPx=${Math.max(width, 800)}`);
  }

  return trimmed;
}
