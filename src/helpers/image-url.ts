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
    const standardSizes = [20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840];
    const target = standardSizes.find((size) => size >= width) ?? standardSizes[standardSizes.length - 1];
    const path = parsed.pathname;
    const thumbMatch = path.match(/^(.*\/thumb\/[^/]+\/[^/]+\/[^/]+)\/\d+px-(.+)$/);
    if (thumbMatch) {
      return `${parsed.origin}${thumbMatch[1]}/${target}px-${thumbMatch[2]}${parsed.search}${parsed.hash}`;
    }
    const fullMatch = path.match(/^\/wikipedia\/([^/]+)\/([0-9a-f])\/([0-9a-f]{2})\/(.+)$/i);
    if (fullMatch) {
      const [, project, a, ab, file] = fullMatch;
      return `${parsed.origin}/wikipedia/${project}/thumb/${a}/${ab}/${file}/${target}px-${file}${parsed.search}${parsed.hash}`;
    }
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
