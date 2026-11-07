import { getStoreRecord, putStoreRecord } from "./apify";
import { canonicalProfileUrl } from "./text";

export const PROFILE_CACHE_MS = 30 * 24 * 60 * 60 * 1000;
export const SEARCH_CACHE_MS = 24 * 60 * 60 * 1000;
export const POST_TOP_N = 5;

type CacheEntry = { fetchedAt: string; payload: unknown };

export type ProfileCache = {
  getProfile(url: string, now: Date): Promise<unknown | null>;
  putProfile(url: string, item: unknown, now: Date): Promise<void>;
  getPosts(url: string, now: Date): Promise<unknown[] | null>;
  putPosts(url: string, items: unknown[], now: Date): Promise<void>;
  getSearch(key: string, now: Date): Promise<unknown[] | null>;
  putSearch(key: string, items: unknown[], now: Date): Promise<void>;
};

export function profileCacheKey(url: string): string | null {
  const canonical = canonicalProfileUrl(url);
  return canonical ? encodeURIComponent(canonical) : null;
}

export function searchCacheKey(query: string, location: string, page: number): string {
  return `${query.trim().toLowerCase()}|${location.trim().toLowerCase()}|${page}`;
}

function fresh(entry: CacheEntry | null | undefined, maxAgeMs: number, now: Date): unknown | null {
  if (!entry?.fetchedAt) return null;
  const fetched = new Date(entry.fetchedAt).getTime();
  if (!Number.isFinite(fetched)) return null;
  if (now.getTime() - fetched > maxAgeMs) return null;
  return entry.payload;
}

export function createMemoryCache(): ProfileCache {
  const profiles = new Map<string, CacheEntry>();
  const posts = new Map<string, CacheEntry>();
  const searches = new Map<string, CacheEntry>();
  return {
    async getProfile(url, now) {
      const key = profileCacheKey(url);
      return key ? fresh(profiles.get(key), PROFILE_CACHE_MS, now) : null;
    },
    async putProfile(url, item, now) {
      const key = profileCacheKey(url);
      if (key) profiles.set(key, { fetchedAt: now.toISOString(), payload: item });
    },
    async getPosts(url, now) {
      const key = profileCacheKey(url);
      const payload = key ? fresh(posts.get(key), PROFILE_CACHE_MS, now) : null;
      return Array.isArray(payload) ? payload : null;
    },
    async putPosts(url, items, now) {
      const key = profileCacheKey(url);
      if (key) posts.set(key, { fetchedAt: now.toISOString(), payload: items });
    },
    async getSearch(key, now) {
      const payload = fresh(searches.get(encodeURIComponent(key)), SEARCH_CACHE_MS, now);
      return Array.isArray(payload) ? payload : null;
    },
    async putSearch(key, items, now) {
      searches.set(encodeURIComponent(key), { fetchedAt: now.toISOString(), payload: items });
    },
  };
}

function storeKey(prefix: string, id: string): string {
  return `${prefix}-${id}`.slice(0, 240);
}

async function readEntry(token: string, key: string): Promise<CacheEntry | null> {
  const stored = await getStoreRecord(token, key);
  if (!stored || typeof stored !== "object") return null;
  const record = stored as { fetchedAt?: unknown; payload?: unknown };
  if (typeof record.fetchedAt !== "string") return null;
  return { fetchedAt: record.fetchedAt, payload: record.payload };
}

export function createApifyCache(token: string): ProfileCache {
  return {
    async getProfile(url, now) {
      const id = profileCacheKey(url);
      if (!id) return null;
      return fresh(await readEntry(token, storeKey("profile", id)), PROFILE_CACHE_MS, now);
    },
    async putProfile(url, item, now) {
      const id = profileCacheKey(url);
      if (!id) return;
      await putStoreRecord(token, storeKey("profile", id), { fetchedAt: now.toISOString(), payload: item });
    },
    async getPosts(url, now) {
      const id = profileCacheKey(url);
      if (!id) return null;
      const payload = fresh(await readEntry(token, storeKey("posts", id)), PROFILE_CACHE_MS, now);
      return Array.isArray(payload) ? payload : null;
    },
    async putPosts(url, items, now) {
      const id = profileCacheKey(url);
      if (!id) return;
      await putStoreRecord(token, storeKey("posts", id), { fetchedAt: now.toISOString(), payload: items });
    },
    async getSearch(key, now) {
      const payload = fresh(await readEntry(token, storeKey("page", encodeURIComponent(key))), SEARCH_CACHE_MS, now);
      return Array.isArray(payload) ? payload : null;
    },
    async putSearch(key, items, now) {
      await putStoreRecord(token, storeKey("page", encodeURIComponent(key)), { fetchedAt: now.toISOString(), payload: items });
    },
  };
}
