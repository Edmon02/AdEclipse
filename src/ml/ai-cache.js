/**
 * AdEclipse AI Cache
 * LRU in-memory cache with chrome.storage.local persistence and domain-level pattern learning
 */

class AICache {
  constructor() {
    this.memoryCache = new Map();
    this.maxMemoryEntries = 1000;
    this.defaultTtlMs = 24 * 60 * 60 * 1000;
    this.patternCache = new Map();
    this.storageKey = 'adeclipse_ai_cache';
    this.patternStorageKey = 'adeclipse_ai_patterns';
    this._loaded = false;
  }

  async init(options = {}) {
    if (options.cacheDurationHours) {
      this.defaultTtlMs = options.cacheDurationHours * 60 * 60 * 1000;
    }
    await this._loadFromStorage();
    this._loaded = true;
  }

  generateKey(domain, elementSignature) {
    const raw = `${domain}||${elementSignature}`;
    return this._hashString(raw);
  }

  generateElementSignature(descriptor) {
    const parts = [
      descriptor.tag || '',
      (descriptor.classes || []).sort().join(','),
      descriptor.id || '',
      Math.round((descriptor.width || 0) / 10) * 10,
      Math.round((descriptor.height || 0) / 10) * 10,
      descriptor.hasIframe ? 'iframe' : '',
      descriptor.externalLinkCount > 0 ? 'ext' : ''
    ];
    return parts.join('|');
  }

  get(domain, elementSignature) {
    const key = this.generateKey(domain, elementSignature);
    const entry = this.memoryCache.get(key);

    if (!entry) {
      return this._checkPatternCache(domain, elementSignature);
    }

    if (Date.now() > entry.expiresAt) {
      this.memoryCache.delete(key);
      return null;
    }

    this.memoryCache.delete(key);
    this.memoryCache.set(key, entry);

    return entry.verdict;
  }

  set(domain, elementSignature, verdict, ttlMs) {
    const key = this.generateKey(domain, elementSignature);
    const expiresAt = Date.now() + (ttlMs || this.defaultTtlMs);

    if (this.memoryCache.size >= this.maxMemoryEntries) {
      const firstKey = this.memoryCache.keys().next().value;
      this.memoryCache.delete(firstKey);
    }

    this.memoryCache.set(key, { verdict, expiresAt, domain, signature: elementSignature });

    if (verdict.isAd && verdict.confidence >= 0.8) {
      this._learnPattern(domain, elementSignature, verdict);
    }
  }

  setBatch(domain, results) {
    for (const result of results) {
      if (result.elementSignature) {
        this.set(domain, result.elementSignature, {
          isAd: result.isAd,
          confidence: result.confidence,
          adType: result.adType,
          reason: result.reason
        });
      }
    }
  }

  _learnPattern(domain, signature, verdict) {
    const parts = signature.split('|');
    const classes = parts[1] || '';
    if (!classes) return;

    const patternKey = `${domain}||class:${classes}`;
    const existing = this.patternCache.get(patternKey);

    if (existing) {
      existing.hitCount++;
      existing.lastSeen = Date.now();
    } else {
      this.patternCache.set(patternKey, {
        verdict: { isAd: verdict.isAd, confidence: verdict.confidence, adType: verdict.adType, reason: 'pattern-match' },
        hitCount: 1,
        lastSeen: Date.now()
      });
    }
  }

  _checkPatternCache(domain, elementSignature) {
    const parts = elementSignature.split('|');
    const classes = parts[1] || '';
    if (!classes) return null;

    const patternKey = `${domain}||class:${classes}`;
    const pattern = this.patternCache.get(patternKey);

    if (pattern && pattern.hitCount >= 2) {
      return pattern.verdict;
    }
    return null;
  }

  async persist() {
    try {
      const entries = {};
      const now = Date.now();
      let count = 0;

      for (const [key, entry] of this.memoryCache) {
        if (entry.expiresAt > now && count < 500) {
          entries[key] = entry;
          count++;
        }
      }

      const patterns = {};
      for (const [key, pattern] of this.patternCache) {
        if (pattern.hitCount >= 2) {
          patterns[key] = pattern;
        }
      }

      await chrome.storage.local.set({
        [this.storageKey]: entries,
        [this.patternStorageKey]: patterns
      });
    } catch (error) {
      console.error('[AdEclipse AI Cache] Persist error:', error);
    }
  }

  async _loadFromStorage() {
    try {
      const data = await chrome.storage.local.get([this.storageKey, this.patternStorageKey]);
      const now = Date.now();

      if (data[this.storageKey]) {
        for (const [key, entry] of Object.entries(data[this.storageKey])) {
          if (entry.expiresAt > now) {
            this.memoryCache.set(key, entry);
          }
        }
      }

      if (data[this.patternStorageKey]) {
        for (const [key, pattern] of Object.entries(data[this.patternStorageKey])) {
          this.patternCache.set(key, pattern);
        }
      }
    } catch (error) {
      console.error('[AdEclipse AI Cache] Load error:', error);
    }
  }

  clear() {
    this.memoryCache.clear();
    this.patternCache.clear();
    try {
      chrome.storage.local.remove([this.storageKey, this.patternStorageKey]);
    } catch (e) { /* ignore in non-extension contexts */ }
  }

  getStats() {
    return {
      memoryCacheSize: this.memoryCache.size,
      patternCacheSize: this.patternCache.size,
      maxMemoryEntries: this.maxMemoryEntries,
      ttlHours: this.defaultTtlMs / (60 * 60 * 1000)
    };
  }

  _hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return 'aic_' + Math.abs(hash).toString(36);
  }
}

export { AICache };
