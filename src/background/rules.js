/**
 * AdEclipse - Rules Manager
 * Manages ad blocking rules and periodic updates
 */

export class RulesManager {
  constructor() {
    this.selectors = null;
    this.domains = null;
    this.customRules = null;
    this.lastUpdate = null;
  }
  
  /**
   * Initialize rules manager
   */
  async initialize() {
    await this.loadRules();
  }
  
  /**
   * Load all rules from storage/files
   */
  async loadRules() {
    try {
      // Load bundled rules
      const [selectorsResponse, domainsResponse] = await Promise.all([
        fetch(chrome.runtime.getURL('rules/site-selectors.json')),
        fetch(chrome.runtime.getURL('rules/ad-domains.json'))
      ]);
      
      this.selectors = await selectorsResponse.json();
      this.domains = await domainsResponse.json();
      
      // Load custom rules from storage
      const result = await chrome.storage.local.get('customRules');
      this.customRules = result.customRules || { domains: [], selectors: {} };
      
      console.log('[RulesManager] Rules loaded successfully');
    } catch (error) {
      console.error('[RulesManager] Error loading rules:', error);
    }
  }
  
  /**
   * Reload rules (after custom rules update)
   */
  async reloadRules() {
    await this.loadRules();
  }
  
  /**
   * Get selectors for a specific site
   */
  async getSelectorsForSite(hostname) {
    if (!this.selectors) {
      await this.loadRules();
    }
    
    const result = {
      site: null,
      generic: this.selectors?.generic?.selectors || {},
      cookieBanners: this.selectors?.cookieBanners?.selectors || [],
      custom: {}
    };
    
    // Find site-specific selectors
    const siteMappings = {
      'youtube.com': 'youtube',
      'www.youtube.com': 'youtube',
      'm.youtube.com': 'youtube',
      'reddit.com': 'reddit',
      'www.reddit.com': 'reddit',
      'old.reddit.com': 'reddit',
      'cnn.com': 'cnn',
      'www.cnn.com': 'cnn',
      'nytimes.com': 'nytimes',
      'www.nytimes.com': 'nytimes',
      'forbes.com': 'forbes',
      'www.forbes.com': 'forbes',
      'twitter.com': 'twitter',
      'x.com': 'twitter',
      'www.twitter.com': 'twitter',
      'facebook.com': 'facebook',
      'www.facebook.com': 'facebook',
      'm.facebook.com': 'facebook'
    };
    
    // Check for exact match
    const siteKey = siteMappings[hostname];
    if (siteKey && this.selectors[siteKey]) {
      result.site = this.selectors[siteKey];
    }
    
    // Check for pattern match in custom rules
    if (this.customRules?.selectors) {
      for (const [pattern, selectors] of Object.entries(this.customRules.selectors)) {
        if (hostname.includes(pattern) || new RegExp(pattern).test(hostname)) {
          result.custom = { ...result.custom, ...selectors };
        }
      }
    }
    
    return result;
  }
  
  /**
   * Check for rule updates from remote
   */
  async checkForUpdates() {
    try {
      const settings = await chrome.storage.local.get('settings');
      const { updates } = settings.settings || {};
      
      if (!updates?.autoUpdate) {
        return;
      }
      
      const updateUrl = updates.updateUrl || 'https://raw.githubusercontent.com/adeclipse/rules/main/';
      
      // Fetch version info
      const versionResponse = await fetch(`${updateUrl}version.json`, {
        cache: 'no-cache'
      });
      
      if (!versionResponse.ok) {
        console.log('[RulesManager] No updates available');
        return;
      }
      
      const versionInfo = await versionResponse.json();
      
      // Check if update needed
      if (versionInfo.version === this.selectors?.version) {
        console.log('[RulesManager] Rules are up to date');
        return;
      }
      
      // Fetch updated rules
      const [newSelectors, newDomains] = await Promise.all([
        fetch(`${updateUrl}site-selectors.json`).then(r => r.json()),
        fetch(`${updateUrl}ad-domains.json`).then(r => r.json())
      ]);
      
      // Store updated rules
      await chrome.storage.local.set({
        cachedSelectors: newSelectors,
        cachedDomains: newDomains,
        lastRuleUpdate: new Date().toISOString()
      });
      
      // Reload
      this.selectors = newSelectors;
      this.domains = newDomains;
      
      console.log('[RulesManager] Rules updated to version:', versionInfo.version);
    } catch (error) {
      console.error('[RulesManager] Update check failed:', error);
    }
  }
  
  /**
   * Get all blocked domains
   */
  getAllBlockedDomains() {
    if (!this.domains) return [];
    
    const allDomains = [];
    
    for (const category of Object.values(this.domains)) {
      if (Array.isArray(category.domains)) {
        allDomains.push(...category.domains);
      } else if (Array.isArray(category)) {
        allDomains.push(...category);
      }
    }
    
    // Add custom domains
    if (this.customRules?.domains) {
      allDomains.push(...this.customRules.domains);
    }
    
    return [...new Set(allDomains)];
  }
  
  /**
   * Validate a custom selector
   */
  validateSelector(selector) {
    try {
      document.querySelector(selector);
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }
  
  /**
   * Validate a custom domain pattern
   */
  validateDomain(domain) {
    const pattern = /^[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z0-9][-a-zA-Z0-9]*)*$/;
    return {
      valid: pattern.test(domain) || domain.includes('*'),
      error: pattern.test(domain) ? null : 'Invalid domain format'
    };
  }
}
