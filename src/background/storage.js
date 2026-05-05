/**
 * AdEclipse - Storage Manager
 * Handles persistent storage operations
 */

const DEFAULT_SETTINGS = {
  enabled: true,
  mode: 'balanced', // 'light', 'balanced', 'aggressive'
  debugMode: false,

  // Block types
  blockTypes: {
    videoAds: true,
    bannerAds: true,
    overlayAds: true,
    sponsoredContent: true,
    popups: true,
    trackers: true,
    cookieBanners: false,
    newsletterPopups: false,
    socialWidgets: false
  },

  // YouTube-specific
  youtube: {
    enabled: true,
    autoSkip: true,
    speedUpAds: true,
    muteAds: true,
    useDocumentStartScripts: true,
    diagnosticsEnabled: true,
    diagnosticsMaxEntries: 120,
    sessionRuleProfile: 'balanced',
    blockOverlays: true,
    blockMasthead: true,
    blockSponsored: true,
    blockMerch: true,
    blockEndCards: false
  },

  // Site lists
  whitelist: [],
  blacklist: [],

  // Website ad blocking mode: 'all' = block ads on all sites, 'manual' = only block on blacklisted sites
  websiteMode: 'manual',

  // Performance
  performance: {
    lazyLoad: true,
    debounceMs: 100,
    maxMutations: 50,
    cacheEnabled: true,
    useML: false // TensorFlow.js integration
  },

  // UI preferences
  ui: {
    showBadge: true,
    showNotifications: false,
    darkMode: 'auto',
    compactMode: false
  },

  // Update settings
  updates: {
    autoUpdate: true,
    updateUrl: 'https://raw.githubusercontent.com/adeclipse/rules/main/',
    lastUpdate: null
  },

  // AI-powered ad detection via LLM APIs
  ai: {
    enabled: false,
    provider: 'openai',
    apiKey: '',
    model: '',
    customBaseUrl: '',
    customModelName: '',
    confidenceThreshold: 0.7,
    scanMode: 'smart',       // 'smart' | 'ai-only' | 'ai-assist'
    maxElementsPerBatch: 30,
    cacheDurationHours: 24,
    scanOnLoad: true,
    continuousScan: true,
    smoothRemoval: true,
    showAiBadge: true,
    usageStats: { totalTokens: 0, totalRequests: 0 }
  }
};

export class StorageManager {
  constructor() {
    this.cache = null;
    this.cacheTimeout = 5000; // 5 seconds
    this.lastCacheTime = 0;
  }

  /**
   * Get all settings
   */
  async getSettings() {
    const now = Date.now();

    // Return cached if valid
    if (this.cache && (now - this.lastCacheTime) < this.cacheTimeout) {
      return this.cache;
    }

    try {
      const result = await chrome.storage.local.get('settings');
      this.cache = this.deepMerge(DEFAULT_SETTINGS, result.settings || {});
      this.lastCacheTime = now;
      return this.cache;
    } catch (error) {
      console.error('[StorageManager] Error getting settings:', error);
      return DEFAULT_SETTINGS;
    }
  }

  /**
   * Update settings (partial update)
   */
  async updateSettings(updates) {
    try {
      const current = await this.getSettings();
      const merged = this.deepMerge(current, updates);
      await chrome.storage.local.set({ settings: merged });
      this.cache = merged;
      this.lastCacheTime = Date.now();
    } catch (error) {
      console.error('[StorageManager] Error updating settings:', error);
      throw error;
    }
  }

  /**
   * Initialize default settings
   */
  async initializeDefaults() {
    try {
      const existing = await chrome.storage.local.get('settings');
      const merged = this.deepMerge(DEFAULT_SETTINGS, existing.settings || {});

      if (!existing.settings || JSON.stringify(existing.settings) !== JSON.stringify(merged)) {
        await chrome.storage.local.set({ settings: merged });
      }
    } catch (error) {
      console.error('[StorageManager] Error initializing defaults:', error);
    }
  }

  /**
   * Get custom rules
   */
  async getCustomRules() {
    try {
      const result = await chrome.storage.local.get('customRules');
      return result.customRules || {
        domains: [],
        selectors: {}
      };
    } catch (error) {
      console.error('[StorageManager] Error getting custom rules:', error);
      return { domains: [], selectors: {} };
    }
  }

  /**
   * Save custom rules
   */
  async saveCustomRules(rules) {
    try {
      await chrome.storage.local.set({ customRules: rules });
    } catch (error) {
      console.error('[StorageManager] Error saving custom rules:', error);
      throw error;
    }
  }

  /**
   * Export all data
   */
  async exportAll() {
    try {
      const data = await chrome.storage.local.get(null);
      return {
        version: chrome.runtime.getManifest().version,
        exportDate: new Date().toISOString(),
        data
      };
    } catch (error) {
      console.error('[StorageManager] Error exporting:', error);
      throw error;
    }
  }

  /**
   * Import all data
   */
  async importAll(importData) {
    try {
      if (!importData.data) {
        throw new Error('Invalid import data');
      }

      // Clear existing data
      await chrome.storage.local.clear();

      // Import new data
      await chrome.storage.local.set(importData.data);

      // Clear cache
      this.cache = null;
    } catch (error) {
      console.error('[StorageManager] Error importing:', error);
      throw error;
    }
  }

  /**
   * Deep merge helper
   */
  deepMerge(target, source) {
    if (Array.isArray(source)) {
      return source.slice();
    }

    if (!this.isMergeableObject(target) || !this.isMergeableObject(source)) {
      return source;
    }

    const output = { ...target };

    for (const key of Object.keys(source)) {
      if (Array.isArray(source[key])) {
        output[key] = source[key].slice();
      } else if (this.isMergeableObject(source[key]) && this.isMergeableObject(target[key])) {
        output[key] = this.deepMerge(target[key], source[key]);
      } else {
        output[key] = source[key];
      }
    }

    return output;
  }

  isMergeableObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
}
