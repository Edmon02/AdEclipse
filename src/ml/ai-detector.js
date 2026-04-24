/**
 * AdEclipse AI Detector
 * Orchestrates LLM-based ad detection: batching, caching, parsing
 */

import { AIProvider } from './ai-provider.js';
import { AICache } from './ai-cache.js';
import { buildMessages } from './prompt-templates.js';

class AIAdDetector {
  constructor() {
    this.provider = new AIProvider();
    this.cache = new AICache();
    this.scanMode = 'smart';
    this.confidenceThreshold = 0.7;
    this.maxElementsPerBatch = 30;
    this.initialized = false;
    this._pendingRequests = new Map();
  }

  async init(settings) {
    if (!settings?.ai?.enabled) return false;

    const aiSettings = settings.ai;
    this.scanMode = aiSettings.scanMode || 'smart';
    this.confidenceThreshold = aiSettings.confidenceThreshold ?? 0.7;
    this.maxElementsPerBatch = aiSettings.maxElementsPerBatch || 30;

    this.provider.configure(aiSettings);
    await this.cache.init({ cacheDurationHours: aiSettings.cacheDurationHours || 24 });

    this.initialized = true;
    return true;
  }

  async scanElements(elementDescriptors, domain) {
    if (!this.initialized || !elementDescriptors.length) {
      return elementDescriptors.map(el => ({
        elementId: el.id,
        isAd: false,
        confidence: 0,
        adType: 'none',
        reason: 'AI not initialized',
        source: 'skip'
      }));
    }

    const results = new Array(elementDescriptors.length);
    const uncachedElements = [];
    const uncachedIndices = [];

    for (let i = 0; i < elementDescriptors.length; i++) {
      const el = elementDescriptors[i];
      const signature = this.cache.generateElementSignature(el);
      const cached = this.cache.get(domain, signature);

      if (cached) {
        results[i] = { elementId: el.id, ...cached, source: 'cache' };
      } else {
        el._signature = signature;
        uncachedElements.push(el);
        uncachedIndices.push(i);
      }
    }

    if (uncachedElements.length === 0) return results;

    const batches = this._chunk(uncachedElements, this.maxElementsPerBatch);
    let batchOffset = 0;

    for (const batch of batches) {
      try {
        const verdicts = await this._analyzeWithLLM(batch, domain);

        for (let j = 0; j < batch.length; j++) {
          const verdict = verdicts[j] || {
            isAd: false, confidence: 0, adType: 'none', reason: 'No response'
          };

          const globalIndex = uncachedIndices[batchOffset + j];
          const el = batch[j];

          results[globalIndex] = {
            elementId: el.id,
            isAd: verdict.isAd && verdict.confidence >= this.confidenceThreshold,
            confidence: verdict.confidence,
            adType: verdict.adType || 'none',
            reason: verdict.reason || '',
            source: 'ai'
          };

          this.cache.set(domain, el._signature, {
            isAd: verdict.isAd,
            confidence: verdict.confidence,
            adType: verdict.adType || 'none',
            reason: verdict.reason || ''
          });
        }
      } catch (error) {
        console.error('[AdEclipse AI] Batch analysis error:', error);
        for (let j = 0; j < batch.length; j++) {
          const globalIndex = uncachedIndices[batchOffset + j];
          results[globalIndex] = {
            elementId: batch[j].id,
            isAd: false,
            confidence: 0,
            adType: 'none',
            reason: `Error: ${error.message}`,
            source: 'error'
          };
        }
      }
      batchOffset += batch.length;
    }

    this.cache.persist().catch(() => {});

    return results;
  }

  async _analyzeWithLLM(elements, domain) {
    const messages = buildMessages(domain, elements, elements.length <= 10);

    const response = await this.provider.sendChatCompletion(messages, {
      temperature: 0.1,
      maxTokens: Math.min(elements.length * 150, 4096),
      responseFormat: { type: 'json_object' }
    });

    return this._parseResponse(response.content, elements);
  }

  _parseResponse(content, elements) {
    try {
      let cleaned = content.trim();

      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      let parsed = JSON.parse(cleaned);

      if (parsed && !Array.isArray(parsed)) {
        const arrayKey = Object.keys(parsed).find(k => Array.isArray(parsed[k]));
        if (arrayKey) {
          parsed = parsed[arrayKey];
        } else {
          parsed = [parsed];
        }
      }

      if (!Array.isArray(parsed)) {
        return elements.map(() => ({ isAd: false, confidence: 0, adType: 'none', reason: 'Parse error' }));
      }

      return elements.map((el, i) => {
        const match = parsed[i]
          || parsed.find(p => p.id === el.id)
          || { isAd: false, confidence: 0, adType: 'none', reason: 'Not found in response' };

        return {
          isAd: !!match.isAd,
          confidence: typeof match.confidence === 'number' ? Math.max(0, Math.min(1, match.confidence)) : 0,
          adType: match.adType || 'none',
          reason: (match.reason || '').slice(0, 100)
        };
      });
    } catch (error) {
      console.error('[AdEclipse AI] Response parse error:', error, content?.slice(0, 200));
      return elements.map(() => ({ isAd: false, confidence: 0, adType: 'none', reason: 'Parse error' }));
    }
  }

  _chunk(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  async testConnection(settings) {
    const tempProvider = new AIProvider();
    tempProvider.configure(settings);
    return tempProvider.testConnection();
  }

  getUsageStats() {
    return this.provider.getUsageStats();
  }

  getCacheStats() {
    return this.cache.getStats();
  }

  clearCache() {
    this.cache.clear();
  }
}

export { AIAdDetector };
