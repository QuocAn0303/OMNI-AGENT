import { useRef, useCallback, useState } from 'react';
import axios from '../api/axios';

const cache = new Map();
const DEFAULT_TTL = 30000;

const getCached = (key, ttl) => {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < ttl) return entry.data;
  cache.delete(key);
  return null;
};

const setCached = (key, data) => {
  cache.set(key, { ts: Date.now(), data });
};

const useCachedFetch = () => {
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  const fetch = useCallback(async (url, params = {}, options = {}) => {
    const { ttl = DEFAULT_TTL, skipCache = false } = options;
    const cacheKey = `${url}?${JSON.stringify(params)}`;

    if (!skipCache) {
      const cached = getCached(cacheKey, ttl);
      if (cached) return cached;
    }

    setLoading(true);
    try {
      const res = await axios.get(url, { params });
      const data = res.data?.data || res.data || [];
      setCached(cacheKey, data);
      return data;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  const invalidate = useCallback((pattern) => {
    if (pattern) {
      for (const key of cache.keys()) {
        if (key.startsWith(pattern)) cache.delete(key);
      }
    } else {
      cache.clear();
    }
  }, []);

  return { fetch, loading, invalidate };
};

export { useCachedFetch, invalidateCache, clearAllCache };
const invalidateCache = (pattern) => {
  if (pattern) {
    for (const key of cache.keys()) {
      if (key.startsWith(pattern)) cache.delete(key);
    }
  } else {
    cache.clear();
  }
};
const clearAllCache = () => cache.clear();
