import { prisma } from "../config/index.js";
import { getOpenSearchConfig, isOpenSearchConfigured } from "../config/opensearch.js";

/**
 * Dating profile search backed by OpenSearch.
 *
 * OpenSearch is optional. Every function here is best-effort: when the cluster
 * is not configured, unreachable, or returns an error, the caller falls back to
 * the Postgres query. Indexing is fire-and-forget so a search outage never
 * blocks profile writes.
 */

export interface DatingSearchHit {
  userId: string;
  fullName: string;
  username: string | null;
  profileImageUrl: string | null;
  headline: string | null;
}

export interface DatingSearchOptions {
  from?: number;
  size?: number;
}

const INDEX_MAPPINGS = {
  mappings: {
    properties: {
      userId: { type: "keyword" },
      fullName: {
        type: "text",
        fields: { keyword: { type: "keyword" } },
      },
      username: { type: "keyword" },
      headline: { type: "text" },
      about: { type: "text" },
      photos: { type: "keyword", index: false },
      profileImageUrl: { type: "keyword", index: false },
      gender: { type: "keyword" },
      location: { type: "text" },
      updatedAt: { type: "date" },
    },
  },
};

let indexReady: Promise<boolean> | null = null;

function authHeader(): Record<string, string> {
  const config = getOpenSearchConfig();
  if (!config?.username) return {};
  const token = Buffer.from(`${config.username}:${config.password ?? ""}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

async function request(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response | null> {
  const config = getOpenSearchConfig();
  if (!config) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    return await fetch(`${config.node}${path}`, {
      method: init.method ?? "GET",
      headers: {
        "content-type": "application/json",
        ...authHeader(),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
  } catch (error) {
    console.warn("[search] OpenSearch request failed:", (error as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function isDatingSearchEnabled(): boolean {
  return isOpenSearchConfigured();
}

async function createIndex(): Promise<boolean> {
  const config = getOpenSearchConfig();
  if (!config) return false;

  const response = await request(`/${encodeURIComponent(config.index)}`, {
    method: "PUT",
    body: INDEX_MAPPINGS,
  });
  // 200 = created, 400 with resource_already_exists is also fine.
  return Boolean(response?.ok || response?.status === 400);
}

export async function ensureDatingSearchIndex(): Promise<boolean> {
  const config = getOpenSearchConfig();
  if (!config) return false;

  if (!indexReady) {
    indexReady = (async () => {
      const head = await request(`/${encodeURIComponent(config.index)}`, { method: "HEAD" });
      if (head?.ok) return true;
      return createIndex();
    })();
  }

  try {
    const ready = await indexReady;
    // Do not cache a failed probe: the cluster may come back later.
    if (!ready) indexReady = null;
    return ready;
  } catch {
    indexReady = null;
    return false;
  }
}

interface IndexableUser {
  id: string;
  fullName: string;
  username: string | null;
  profileImageUrl: string | null;
  gender: string | null;
  datingProfile: {
    headline: string | null;
    about: string | null;
    photos: string[];
    location: string | null;
  } | null;
}

async function indexableUser(userId: string): Promise<IndexableUser | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      username: true,
      profileImageUrl: true,
      gender: true,
      datingProfile: {
        select: {
          headline: true,
          about: true,
          photos: true,
          location: true,
        },
      },
    },
  }) as Promise<IndexableUser | null>;
}

export async function indexDatingProfile(userId: string): Promise<void> {
  const config = getOpenSearchConfig();
  if (!config) return;
  if (!(await ensureDatingSearchIndex())) return;

  try {
    const user = await indexableUser(userId);
    if (!user?.datingProfile) {
      await removeDatingProfileFromIndex(userId);
      return;
    }

    const document = {
      userId: user.id,
      fullName: user.fullName,
      username: user.username,
      profileImageUrl: user.profileImageUrl,
      gender: user.gender,
      headline: user.datingProfile.headline,
      about: user.datingProfile.about,
      photos: user.datingProfile.photos,
      location: user.datingProfile.location,
      updatedAt: new Date().toISOString(),
    };

    const response = await request(
      `/${encodeURIComponent(config.index)}/_doc/${encodeURIComponent(userId)}`,
      { method: "PUT", body: document },
    );
    if (!response?.ok) {
      console.warn("[search] Failed to index dating profile", userId, response?.status);
    }
  } catch (error) {
    console.warn("[search] Dating profile indexing skipped:", (error as Error).message);
  }
}

export async function removeDatingProfileFromIndex(userId: string): Promise<void> {
  const config = getOpenSearchConfig();
  if (!config) return;
  if (!(await ensureDatingSearchIndex())) return;

  const response = await request(
    `/${encodeURIComponent(config.index)}/_doc/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );
  if (response && !response.ok && response.status !== 404) {
    console.warn("[search] Failed to remove dating profile from index", userId, response.status);
  }
}

interface OpenSearchHit {
  _source?: Partial<DatingSearchHit> & { userId?: string };
  _score?: number;
}

interface OpenSearchResponse {
  hits?: {
    hits?: OpenSearchHit[];
  };
}

function toHit(hit: OpenSearchHit): DatingSearchHit | null {
  const source = hit._source;
  if (!source?.userId) return null;
  return {
    userId: source.userId,
    fullName: source.fullName ?? "",
    username: source.username ?? null,
    profileImageUrl: source.profileImageUrl ?? null,
    headline: source.headline ?? null,
  };
}

function searchBody(query: string, options: DatingSearchOptions) {
  return {
    from: options.from ?? 0,
    size: options.size ?? 10,
    _source: ["userId", "fullName", "username", "profileImageUrl", "headline"],
    query: {
      bool: {
        should: [
          {
            multi_match: {
              query,
              fields: ["fullName^3", "username^2", "headline", "about"],
              fuzziness: "AUTO",
              type: "best_fields",
            },
          },
          { match_phrase_prefix: { fullName: { query, boost: 2 } } },
          { term: { username: { value: query.toLowerCase(), boost: 2 } } },
        ],
        minimum_should_match: 1,
      },
    },
  };
}

/**
 * Returns ranked hits, or null when OpenSearch is not configured/unavailable so
 * the caller can use the Postgres fallback.
 */
export async function searchDatingProfiles(
  query: string,
  options: DatingSearchOptions = {},
): Promise<DatingSearchHit[] | null> {
  const config = getOpenSearchConfig();
  if (!config) return null;
  if (!(await ensureDatingSearchIndex())) return null;

  const path = `/${encodeURIComponent(config.index)}/_search`;
  let response = await request(path, { method: "POST", body: searchBody(query, options) });

  // The index may have been deleted between the HEAD check and the search.
  if (response?.status === 404) {
    indexReady = null;
    if (await ensureDatingSearchIndex()) {
      response = await request(path, { method: "POST", body: searchBody(query, options) });
    }
  }

  if (!response?.ok) return null;

  try {
    const payload = (await response.json()) as OpenSearchResponse;
    const hits = payload.hits?.hits ?? [];
    return hits.map(toHit).filter((hit): hit is DatingSearchHit => hit !== null);
  } catch {
    return null;
  }
}
