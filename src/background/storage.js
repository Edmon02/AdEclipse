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
    blockOverlays: true,
    blockMasthead: true,
    blockSponsored: true,
    blockMerch: true,
    blockEndCards: false
  },
  
  // Site lists
  whitelist: [],
  blacklist: [],
  
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
      this.cache = result.settings || DEFAULT_SETTINGS;
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
      if (!existing.settings) {
        await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
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
    const output = { ...target };
    
    for (const key of Object.keys(source)) {
      if (source[key] instanceof Object && key in target) {
        output[key] = this.deepMerge(target[key], source[key]);
      } else {
        output[key] = source[key];
      }
    }
    
    return output;
  }
}
