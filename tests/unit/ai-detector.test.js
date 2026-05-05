/**
 * Tests for AIAdDetector - LLM orchestrator
 */

const { AIAdDetector } = require('../../src/ml/ai-detector.js');

describe('AIAdDetector', () => {
  let detector;

  beforeEach(() => {
    detector = new AIAdDetector();
    detector.provider._sleep = () => Promise.resolve();
    global.fetch = jest.fn();
    chrome.storage.local.get.mockResolvedValue({});
    chrome.storage.local.set.mockResolvedValue();
  });

  const mockSettings = {
    ai: {
      enabled: true,
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      scanMode: 'smart',
      confidenceThreshold: 0.7,
      maxElementsPerBatch: 30,
      cacheDurationHours: 24
    }
  };

  describe('init', () => {
    test('initializes when enabled with API key', async () => {
      const result = await detector.init(mockSettings);
      expect(result).toBe(true);
      expect(detector.initialized).toBe(true);
    });

    test('returns false when disabled', async () => {
      const result = await detector.init({ ai: { enabled: false } });
      expect(result).toBe(false);
      expect(detector.initialized).toBe(false);
    });

    test('returns false when settings are null', async () => {
      const result = await detector.init(null);
      expect(result).toBe(false);
    });
  });

  describe('scanElements', () => {
    const sampleElements = [
      {
        id: 'el_0',
        tag: 'div',
        classes: ['ad-container'],
        width: 728,
        height: 90,
        hasIframe: true,
        externalLinkCount: 0,
        text: 'Advertisement'
      },
      {
        id: 'el_1',
        tag: 'article',
        classes: ['post-content'],
        width: 800,
        height: 1200,
        hasIframe: false,
        externalLinkCount: 0,
        text: 'Real article content here'
      }
    ];

    test('returns skip results when not initialized', async () => {
      const results = await detector.scanElements(sampleElements, 'example.com');
      expect(results).toHaveLength(2);
      expect(results[0].source).toBe('skip');
      expect(results[0].isAd).toBe(false);
    });

    test('returns empty results for empty input', async () => {
      await detector.init(mockSettings);
      const results = await detector.scanElements([], 'example.com');
      expect(results).toHaveLength(0);
    });

    test('sends elements to LLM and parses response', async () => {
      await detector.init(mockSettings);

      const mockLLMResponse = JSON.stringify([
        { id: 'el_0', isAd: true, confidence: 0.95, adType: 'display', reason: 'Banner ad container' },
        { id: 'el_1', isAd: false, confidence: 0.92, adType: 'none', reason: 'Article content' }
      ]);

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: mockLLMResponse } }],
          usage: { prompt_tokens: 200, completion_tokens: 50, total_tokens: 250 }
        })
      });

      const results = await detector.scanElements(sampleElements, 'example.com');

      expect(results).toHaveLength(2);
      expect(results[0].isAd).toBe(true);
      expect(results[0].confidence).toBe(0.95);
      expect(results[0].adType).toBe('display');
      expect(results[0].source).toBe('ai');
      expect(results[1].isAd).toBe(false);
      expect(results[1].source).toBe('ai');
    });

    test('applies confidence threshold', async () => {
      await detector.init(mockSettings);

      const mockResponse = JSON.stringify([
        { id: 'el_0', isAd: true, confidence: 0.5, adType: 'display', reason: 'Maybe ad' },
        { id: 'el_1', isAd: false, confidence: 0.9, adType: 'none', reason: 'Content' }
      ]);

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: mockResponse } }],
          usage: { total_tokens: 100 }
        })
      });

      const results = await detector.scanElements(sampleElements, 'example.com');
      expect(results[0].isAd).toBe(false); // Below 0.7 threshold
    });

    test('uses cache for repeated elements', async () => {
      await detector.init(mockSettings);

      const mockResponse = JSON.stringify([
        { id: 'el_0', isAd: true, confidence: 0.95, adType: 'display', reason: 'Ad' },
        { id: 'el_1', isAd: false, confidence: 0.9, adType: 'none', reason: 'Content' }
      ]);

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: mockResponse } }],
          usage: { total_tokens: 100 }
        })
      });

      await detector.scanElements(sampleElements, 'example.com');

      // Second scan - should use cache
      const results = await detector.scanElements(sampleElements, 'example.com');
      expect(results[0].source).toBe('cache');
      expect(results[1].source).toBe('cache');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('handles API errors gracefully', async () => {
      await detector.init(mockSettings);

      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: { message: 'Server error' } })
      });

      const results = await detector.scanElements(sampleElements, 'example.com');
      expect(results).toHaveLength(2);
      expect(results[0].isAd).toBe(false);
      expect(results[0].source).toBe('error');
    });
  });

  describe('_parseResponse', () => {
    const elements = [{ id: 'el_0' }, { id: 'el_1' }];

    test('parses clean JSON array', () => {
      const content = '[{"id":"el_0","isAd":true,"confidence":0.9,"adType":"display","reason":"Ad"},{"id":"el_1","isAd":false,"confidence":0.8,"adType":"none","reason":"Content"}]';
      const results = detector._parseResponse(content, elements);
      expect(results[0].isAd).toBe(true);
      expect(results[1].isAd).toBe(false);
    });

    test('handles markdown-wrapped JSON', () => {
      const content = '```json\n[{"id":"el_0","isAd":true,"confidence":0.9,"adType":"display","reason":"Ad"}]\n```';
      const results = detector._parseResponse(content, elements);
      expect(results[0].isAd).toBe(true);
    });

    test('handles JSON object with array property', () => {
      const content = '{"results":[{"id":"el_0","isAd":true,"confidence":0.9,"adType":"display","reason":"Ad"}]}';
      const results = detector._parseResponse(content, elements);
      expect(results[0].isAd).toBe(true);
    });

    test('clamps confidence to 0-1 range', () => {
      const content = '[{"id":"el_0","isAd":true,"confidence":1.5,"adType":"display","reason":"Ad"}]';
      const results = detector._parseResponse(content, elements);
      expect(results[0].confidence).toBe(1);
    });

    test('returns safe defaults on parse error', () => {
      const results = detector._parseResponse('not json at all', elements);
      expect(results).toHaveLength(2);
      expect(results[0].isAd).toBe(false);
      expect(results[0].reason).toBe('Parse error');
    });
  });

  describe('testConnection', () => {
    test('delegates to a fresh provider instance', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"status":"ok"}' } }],
          usage: { total_tokens: 5 }
        })
      });

      const result = await detector.testConnection({
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4o-mini'
      });

      expect(result.success).toBe(true);
    });
  });

  describe('cache management', () => {
    test('clearCache empties the cache', async () => {
      await detector.init(mockSettings);
      detector.cache.set('a.com', 'sig1', { isAd: true, confidence: 0.9 });
      detector.clearCache();
      expect(detector.getCacheStats().memoryCacheSize).toBe(0);
    });

    test('getUsageStats returns provider stats', async () => {
      await detector.init(mockSettings);
      const stats = detector.getUsageStats();
      expect(stats).toHaveProperty('totalRequests');
      expect(stats).toHaveProperty('totalTokens');
    });
  });
});
