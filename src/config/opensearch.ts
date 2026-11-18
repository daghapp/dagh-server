// ─────────────────────────────────────────
// OpenSearch configuration
// ─────────────────────────────────────────
// Search is optional: when OPENSEARCH_NODE is unset (local dev, CI, tests) the
// dating controllers fall back to Postgres. In production set OPENSEARCH_NODE
// and, if your cluster requires auth, OPENSEARCH_USERNAME/OPENSEARCH_PASSWORD.

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export interface OpenSearchConfig {
  node: string;
  username?: string;
  password?: string;
  index: string;
  timeoutMs: number;
}

export function getOpenSearchConfig(): OpenSearchConfig | null {
  const node = clean(process.env.OPENSEARCH_NODE);
  if (!node) return null;

  return {
    node: node.replace(/\/$/, ""),
    username: clean(process.env.OPENSEARCH_USERNAME),
    password: clean(process.env.OPENSEARCH_PASSWORD),
    index: clean(process.env.OPENSEARCH_INDEX) ?? "dagh-dating-profiles",
    timeoutMs: Number(process.env.OPENSEARCH_TIMEOUT_MS) || 3_000,
  };
}

export function isOpenSearchConfigured(): boolean {
  return getOpenSearchConfig() !== null;
}
