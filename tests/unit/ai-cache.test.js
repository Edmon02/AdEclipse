/**
 * Tests for AICache - LRU cache with TTL and pattern learning
 */

const { AICache } = require('../../src/ml/ai-cache.js');

describe('AICache', () => {
  let cache;

  beforeEach(() => {
    cache = new AICache();
    chrome.storage.local.get.mockResolvedValue({});
    chrome.storage.local.set.mockResolvedValue();
    chrome.storage.local.remove.mockResolvedValue();
  });

  describe('generateElementSignature', () => {
    test('creates consistent signatures', () => {
      const descriptor = {
        tag: 'div',
        classes: ['ad-container', 'banner'],
        id: 'top-ad',
        width: 728,
        height: 90,
        hasIframe: true,
        externalLinkCount: 3
      };

      const sig1 = cache.generateElementSignature(descriptor);
      const sig2 = cache.generateElementSignature(descriptor);
      expect(sig1).toBe(sig2);
    });

    test('sorts classes for consistency', () => {
      const desc1 = { tag: 'div', classes: ['b-class', 'a-class'], width: 100, height: 100 };
      const desc2 = { tag: 'div', classes: ['a-class', 'b-class'], width: 100, height: 100 };
      expect(cache.generateElementSignature(desc1)).toBe(cache.generateElementSignature(desc2));
    });

    test('quantizes dimensions', () => {
      const desc1 = { tag: 'div', classes: [], width: 725, height: 92 };
      const desc2 = { tag: 'div', classes: [], width: 729, height: 88 };
      expect(cache.generateElementSignature(desc1)).toBe(cache.generateElementSignature(desc2));
    });
  });

  describe('get/set', () => {
    test('returns null for missing entries', () => {
      expect(cache.get('example.com', 'div||ad|730|90||')).toBeNull();
    });

    test('stores and retrieves verdicts', () => {
      const verdict = { isAd: true, confidence: 0.95, adType: 'display', reason: 'Google ad' };
      cache.set('example.com', 'div||ad|730|90||', verdict);

      const result = cache.get('example.com', 'div||ad|730|90||');
      expect(result).toEqual(verdict);
    });

    test('expires entries after TTL', () => {
      cache.defaultTtlMs = 100;
      const verdict = { isAd: true, confidence: 0.9, adType: 'display', reason: 'test' };
      cache.set('example.com', 'sig1', verdict);

      expect(cache.get('example.com', 'sig1')).toEqual(verdict);

      const entry = cache.memoryCache.get(cache.generateKey('example.com', 'sig1'));
      entry.expiresAt = Date.now() - 1;

      expect(cache.get('example.com', 'sig1')).toBeNull();
    });

    test('evicts oldest entries at capacity', () => {
      cache.maxMemoryEntries = 3;
      cache.set('a.com', 'sig1', { isAd: true, confidence: 0.9 });
      cache.set('b.com', 'sig2', { isAd: false, confidence: 0.9 });
      cache.set('c.com', 'sig3', { isAd: true, confidence: 0.9 });
      cache.set('d.com', 'sig4', { isAd: true, confidence: 0.9 });

      expect(cache.memoryCache.size).toBe(3);
    });
  });

  describe('setBatch', () => {
    test('caches multiple results at once', () => {
      const results = [
        { elementSignature: 'sig1', isAd: true, confidence: 0.95, adType: 'display', reason: 'ad' },
        { elementSignature: 'sig2', isAd: false, confidence: 0.9, adType: 'none', reason: 'content' }
      ];

      cache.setBatch('example.com', results);
      expect(cache.get('example.com', 'sig1').isAd).toBe(true);
      expect(cache.get('example.com', 'sig2').isAd).toBe(false);
    });
  });

  describe('pattern learning', () => {
    test('learns patterns from high-confidence detections', () => {
      const verdict = { isAd: true, confidence: 0.95, adType: 'display', reason: 'Banner ad' };
      const signature = 'div|ad-container,banner||730|90||';

      cache.set('news.com', signature, verdict);
      cache.set('news.com', signature + '2', verdict);

      const patternResult = cache._checkPatternCache('news.com', signature + '3');
      expect(patternResult).not.toBeNull();
      expect(patternResult.isAd).toBe(true);
    });

    test('requires minimum hit count for pattern match', () => {
      const verdict = { isAd: true, confidence: 0.95, adType: 'display', reason: 'Ad' };
      cache.set('news.com', 'div|ad-class||730|90||', verdict);

      const result = cache._checkPatternCache('news.com', 'div|ad-class||730|90||other');
      expect(result).toBeNull();
    });

    test('does not learn from low-confidence results', () => {
      const verdict = { isAd: true, confidence: 0.6, adType: 'display', reason: 'Maybe ad' };
      cache.set('news.com', 'div|maybe||730|90||', verdict);

      expect(cache.patternCache.size).toBe(0);
    });
  });

  describe('persistence', () => {
    test('persist saves to chrome.storage', async () => {
      cache.set('example.com', 'sig1', { isAd: true, confidence: 0.9, adType: 'display', reason: 'test' });
      await cache.persist();

      expect(chrome.storage.local.set).toHaveBeenCalled();
    });

    test('init loads from chrome.storage', async () => {
      const now = Date.now();
      chrome.storage.local.get.mockResolvedValueOnce({
        adeclipse_ai_cache: {
          key1: {
            verdict: { isAd: true, confidence: 0.9 },
            expiresAt: now + 100000,
            domain: 'test.com',
            signature: 'sig1'
          }
        },
        adeclipse_ai_patterns: {}
      });

      await cache.init();
      expect(cache.memoryCache.size).toBe(1);
    });

    test('skips expired entries on load', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({
        adeclipse_ai_cache: {
          key1: {
            verdict: { isAd: true },
            expiresAt: Date.now() - 1000,
            domain: 'test.com'
          }
        },
        adeclipse_ai_patterns: {}
      });

      await cache.init();
      expect(cache.memoryCache.size).toBe(0);
    });
  });

  describe('clear', () => {
    test('clears all caches', () => {
      cache.set('a.com', 'sig1', { isAd: true, confidence: 0.9 });
      cache.patternCache.set('pattern1', { verdict: { isAd: true }, hitCount: 5 });

      cache.clear();

      expect(cache.memoryCache.size).toBe(0);
      expect(cache.patternCache.size).toBe(0);
    });
  });

  describe('getStats', () => {
    test('returns cache statistics', () => {
      cache.set('a.com', 'sig1', { isAd: true, confidence: 0.9 });
      const stats = cache.getStats();

      expect(stats.memoryCacheSize).toBe(1);
      expect(stats).toHaveProperty('patternCacheSize');
      expect(stats).toHaveProperty('maxMemoryEntries');
      expect(stats).toHaveProperty('ttlHours');
    });
  });
});
