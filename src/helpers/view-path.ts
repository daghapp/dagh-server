import { existsSync } from "fs";
import path from "path";

/**
 * Resolves the views directory in both development and production (dist)
 * layouts. `tsc` does not copy non-TypeScript assets, so in production the
 * HTML/JS views live under dist/src/views while in development they stay in
 * src/views. Without this, res.sendFile(...) throws ENOENT and the request
 * falls through to the 500 handler.
 */
function resolveViewsDir(): string {
  const candidates = [
    path.join(process.cwd(), "src", "views"),
    path.join(process.cwd(), "dist", "src", "views"),
  ];
  return candidates.find((dir) => existsSync(dir)) ?? candidates[0];
}

export function viewsPath(fileName: string): string {
  return path.join(resolveViewsDir(), fileName);
}
