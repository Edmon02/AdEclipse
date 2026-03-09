/**
 * AdEclipse Options Page
 * Settings management and UI interactions
 */

class OptionsPage {
  constructor() {
    this.settings = null;
    this.stats = null;
    this.init();
  }

  async init() {
    await this.loadSettings();
    await this.loadStats();
    this.setupNavigation();
    this.setupEventListeners();
    this.populateUI();
    this.applyTheme();
  }

  // Settings Management
  async loadSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'getSettings' });
      this.settings = response || this.getDefaultSettings();
    } catch (error) {
      console.error('Failed to load settings:', error);
      this.settings = this.getDefaultSettings();
    }
  }

  getDefaultSettings() {
    return {
      enabled: true,
      blockingMode: 'standard',
      theme: 'system',
      blockTypes: {
        videoAds: true,
        overlayAds: true,
        bannerAds: true,
        sponsoredContent: true,
        popups: true,
        tracking: true
      },
      youtube: {
        autoSkip: true,
        speedUpAds: true,
        muteAds: true,
        blockOverlays: true,
        skipDelay: 500,
        speedMultiplier: 16
      },
      whitelist: [],
      blacklist: [],
      websiteMode: 'manual',
      customRules: [],
      performance: {
        observerDebounce: 100,
        enablePerformanceMode: false
      },
      ml: {
        enabled: false
      },
      updates: {
        autoUpdate: true
      },
      showNotifications: true,
      debug: false
    };
  }

  async saveSettings() {
    try {
      await chrome.runtime.sendMessage({
        type: 'saveSettings',
        settings: this.settings
      });
      this.showToast('Settings saved');
    } catch (error) {
      console.error('Failed to save settings:', error);
      this.showToast('Failed to save settings', 'error');
    }
  }

  async loadStats() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'getStats' });
      this.stats = response || { blocked: 0, session: { blocked: 0 }, today: { blocked: 0 } };
    } catch (error) {
      console.error('Failed to load stats:', error);
      this.stats = { blocked: 0, session: { blocked: 0 }, today: { blocked: 0 } };
    }
  }

  // Navigation
  setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.settings-section');

    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const target = item.getAttribute('data-section');

        // Update nav
        navItems.forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');

        // Update sections
        sections.forEach(section => section.classList.remove('active'));
        document.getElementById(target)?.classList.add('active');

        // Update stats if switching to stats section
        if (target === 'stats') {
          this.updateStatsUI();
        }
      });
    });
  }

  // Event Listeners
  setupEventListeners() {
    // General Settings
    this.bindToggle('enableProtection', 'enabled');
    this.bindSelect('blockingMode', 'blockingMode');
    this.bindSelect('theme', 'theme');
    
    // Block Types
    this.bindToggle('blockVideoAds', ['blockTypes', 'videoAds']);
    this.bindToggle('blockOverlayAds', ['blockTypes', 'overlayAds']);
    this.bindToggle('blockBannerAds', ['blockTypes', 'bannerAds']);
    this.bindToggle('blockSponsored', ['blockTypes', 'sponsoredContent']);
    this.bindToggle('blockPopups', ['blockTypes', 'popups']);
    this.bindToggle('blockTracking', ['blockTypes', 'tracking']);

    // YouTube Settings
    this.bindToggle('autoSkipAds', ['youtube', 'autoSkip']);
    this.bindToggle('speedUpAds', ['youtube', 'speedUpAds']);
    this.bindToggle('muteAds', ['youtube', 'muteAds']);
    this.bindToggle('blockYTOverlays', ['youtube', 'blockOverlays']);
    this.bindNumber('skipDelay', ['youtube', 'skipDelay']);
    this.bindSelect('speedMultiplier', ['youtube', 'speedMultiplier']);

    // Advanced Settings
    this.bindNumber('observerDebounce', ['performance', 'observerDebounce']);
    this.bindToggle('performanceMode', ['performance', 'enablePerformanceMode']);
    this.bindToggle('enableML', ['ml', 'enabled']);
    this.bindToggle('autoUpdate', ['updates', 'autoUpdate']);
    this.bindToggle('debugMode', 'debug');

    // Whitelist Management
    this.setupWhitelistEditor();

    // Blacklist (Protected Sites) Management
    this.setupBlacklistEditor();

    // Website Mode
    this.setupWebsiteMode();

    // Custom Rules Management
    this.setupCustomRulesEditor();

    // Import/Export
    document.getElementById('exportSettings')?.addEventListener('click', () => this.exportSettings());
    document.getElementById('importSettings')?.addEventListener('click', () => this.showImportDialog());
    document.getElementById('resetSettings')?.addEventListener('click', () => this.resetSettings());
    document.getElementById('clearStats')?.addEventListener('click', () => this.clearStats());

    // Theme changes
    document.getElementById('theme')?.addEventListener('change', () => {
      this.applyTheme();
    });
  }

  bindToggle(elementId, settingPath) {
    const element = document.getElementById(elementId);
    if (!element) return;

    element.addEventListener('change', () => {
      this.setSetting(settingPath, element.checked);
      this.saveSettings();
    });
  }

  bindSelect(elementId, settingPath) {
    const element = document.getElementById(elementId);
    if (!element) return;

    element.addEventListener('change', () => {
      const value = element.value;
      this.setSetting(settingPath, value);
      this.saveSettings();
    });
  }

  bindNumber(elementId, settingPath) {
    const element = document.getElementById(elementId);
    if (!element) return;

    element.addEventListener('change', () => {
      const value = parseInt(element.value, 10);
      if (!isNaN(value)) {
        this.setSetting(settingPath, value);
        this.saveSettings();
      }
    });
  }

  getSetting(path) {
    if (typeof path === 'string') {
      return this.settings[path];
    }
    return path.reduce((obj, key) => obj?.[key], this.settings);
  }

  setSetting(path, value) {
    if (typeof path === 'string') {
      this.settings[path] = value;
      return;
    }
    
    let obj = this.settings;
    for (let i = 0; i < path.length - 1; i++) {
      if (!obj[path[i]]) obj[path[i]] = {};
      obj = obj[path[i]];
    }
    obj[path[path.length - 1]] = value;
  }

  // UI Population
  populateUI() {
    // General
    this.setToggleValue('enableProtection', this.settings.enabled);
    this.setSelectValue('blockingMode', this.settings.blockingMode);
    this.setSelectValue('theme', this.settings.theme);

    // Block Types
    this.setToggleValue('blockVideoAds', this.settings.blockTypes?.videoAds);
    this.setToggleValue('blockOverlayAds', this.settings.blockTypes?.overlayAds);
    this.setToggleValue('blockBannerAds', this.settings.blockTypes?.bannerAds);
    this.setToggleValue('blockSponsored', this.settings.blockTypes?.sponsoredContent);
    this.setToggleValue('blockPopups', this.settings.blockTypes?.popups);
    this.setToggleValue('blockTracking', this.settings.blockTypes?.tracking);

    // YouTube
    this.setToggleValue('autoSkipAds', this.settings.youtube?.autoSkip);
    this.setToggleValue('speedUpAds', this.settings.youtube?.speedUpAds);
    this.setToggleValue('muteAds', this.settings.youtube?.muteAds);
    this.setToggleValue('blockYTOverlays', this.settings.youtube?.blockOverlays);
    this.setNumberValue('skipDelay', this.settings.youtube?.skipDelay);
    this.setSelectValue('speedMultiplier', String(this.settings.youtube?.speedMultiplier || 16));

    // Advanced
    this.setNumberValue('observerDebounce', this.settings.performance?.observerDebounce);
    this.setToggleValue('performanceMode', this.settings.performance?.enablePerformanceMode);
    this.setToggleValue('enableML', this.settings.ml?.enabled);
    this.setToggleValue('autoUpdate', this.settings.updates?.autoUpdate);
    this.setToggleValue('debugMode', this.settings.debug);

    // Whitelist
    this.renderWhitelist();

    // Blacklist (Protected Sites)
    this.renderBlacklist();
    this.setSelectValue('websiteModeSelect', this.settings.websiteMode || 'manual');
    this.updateProtectedSitesVisibility();

    // Custom Rules
    this.renderCustomRules();

    // Stats
    this.updateStatsUI();
  }

  setToggleValue(elementId, value) {
    const element = document.getElementById(elementId);
    if (element) element.checked = !!value;
  }

  setSelectValue(elementId, value) {
    const element = document.getElementById(elementId);
    if (element && value !== undefined) element.value = value;
  }

  setNumberValue(elementId, value) {
    const element = document.getElementById(elementId);
    if (element && value !== undefined) element.value = value;
  }

  // Whitelist Editor
  setupWhitelistEditor() {
    const addBtn = document.getElementById('addWhitelist');
    const input = document.getElementById('whitelistInput');

    addBtn?.addEventListener('click', () => {
      this.addWhitelistEntry();
    });

    input?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.addWhitelistEntry();
      }
    });
  }

  addWhitelistEntry() {
    const input = document.getElementById('whitelistInput');
    const site = input?.value.trim();
    
    if (!site) return;
    
    // Normalize domain
    let domain = site.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    
    if (!this.settings.whitelist) {
      this.settings.whitelist = [];
    }
    
    if (!this.settings.whitelist.includes(domain)) {
      this.settings.whitelist.push(domain);
      this.saveSettings();
      this.renderWhitelist();
    }
    
    input.value = '';
  }

  removeWhitelistEntry(domain) {
    this.settings.whitelist = this.settings.whitelist.filter(d => d !== domain);
    this.saveSettings();
    this.renderWhitelist();
  }

  renderWhitelist() {
    const list = document.getElementById('whitelistList');
    if (!list) return;

    const whitelist = this.settings.whitelist || [];
    
    if (whitelist.length === 0) {
      list.innerHTML = '<li class="site-list-item"><span style="color: var(--text-muted)">No sites whitelisted</span></li>';
      return;
    }

    list.innerHTML = whitelist.map(domain => `
      <li class="site-list-item">
        <span>${this.escapeHtml(domain)}</span>
        <button class="remove-btn" data-domain="${this.escapeHtml(domain)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </li>
    `).join('');

    // Add remove handlers
    list.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.removeWhitelistEntry(btn.dataset.domain);
      });
    });
  }

  // Website Mode
  setupWebsiteMode() {
    const select = document.getElementById('websiteModeSelect');
    if (!select) return;

    select.addEventListener('change', () => {
      this.settings.websiteMode = select.value;
      this.saveSettings();
      this.updateProtectedSitesVisibility();
    });
  }

  updateProtectedSitesVisibility() {
    const group = document.getElementById('protectedSitesGroup');
    if (!group) return;
    // Show the protected sites list always, but highlight when in manual mode
    group.style.opacity = this.settings.websiteMode === 'manual' ? '1' : '0.5';
  }

  // Blacklist (Protected Sites) Editor
  setupBlacklistEditor() {
    const addBtn = document.getElementById('addBlacklist');
    const input = document.getElementById('blacklistInput');

    addBtn?.addEventListener('click', () => {
      this.addBlacklistEntry();
    });

    input?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.addBlacklistEntry();
      }
    });
  }

  addBlacklistEntry() {
    const input = document.getElementById('blacklistInput');
    const site = input?.value.trim();

    if (!site) return;

    // Normalize domain
    let domain = site.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];

    if (!this.settings.blacklist) {
      this.settings.blacklist = [];
    }

    if (!this.settings.blacklist.includes(domain)) {
      this.settings.blacklist.push(domain);
      this.saveSettings();
      this.renderBlacklist();
    }

    input.value = '';
  }

  removeBlacklistEntry(domain) {
    this.settings.blacklist = this.settings.blacklist.filter(d => d !== domain);
    this.saveSettings();
    this.renderBlacklist();
  }

  renderBlacklist() {
    const list = document.getElementById('blacklistItems');
    if (!list) return;

    const blacklist = this.settings.blacklist || [];

    if (blacklist.length === 0) {
      list.innerHTML = '<li class="site-list-item"><span style="color: var(--text-muted)">No sites added yet</span></li>';
      return;
    }

    list.innerHTML = blacklist.map(domain => `
      <li class="site-list-item">
        <span>${this.escapeHtml(domain)}</span>
        <button class="remove-btn" data-domain="${this.escapeHtml(domain)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </li>
    `).join('');

    // Add remove handlers
    list.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.removeBlacklistEntry(btn.dataset.domain);
      });
    });
  }

  // Custom Rules Editor
  setupCustomRulesEditor() {
    const addBtn = document.getElementById('addRule');
    const domainInput = document.getElementById('ruleDomain');
    const selectorInput = document.getElementById('ruleSelector');

    addBtn?.addEventListener('click', () => {
      this.addCustomRule();
    });

    selectorInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.addCustomRule();
      }
    });
  }

  addCustomRule() {
    const domainInput = document.getElementById('ruleDomain');
    const selectorInput = document.getElementById('ruleSelector');
    
    const domain = domainInput?.value.trim();
    const selector = selectorInput?.value.trim();
    
    if (!domain || !selector) {
      this.showToast('Please enter both domain and selector', 'error');
      return;
    }

    // Validate selector
    try {
      document.querySelector(selector);
    } catch (e) {
      this.showToast('Invalid CSS selector', 'error');
      return;
    }

    if (!this.settings.customRules) {
      this.settings.customRules = [];
    }

    this.settings.customRules.push({ domain, selector });
    this.saveSettings();
    this.renderCustomRules();

    domainInput.value = '';
    selectorInput.value = '';
  }

  removeCustomRule(index) {
    this.settings.customRules.splice(index, 1);
    this.saveSettings();
    this.renderCustomRules();
  }

  renderCustomRules() {
    const list = document.getElementById('rulesList');
    if (!list) return;

    const rules = this.settings.customRules || [];
    
    if (rules.length === 0) {
      list.innerHTML = '<li class="rule-list-item"><span style="color: var(--text-muted)">No custom rules</span></li>';
      return;
    }

    list.innerHTML = rules.map((rule, index) => `
      <li class="rule-list-item">
        <span>${this.escapeHtml(rule.domain)}: ${this.escapeHtml(rule.selector)}</span>
        <button class="remove-btn" data-index="${index}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </li>
    `).join('');

    // Add remove handlers
    list.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.removeCustomRule(parseInt(btn.dataset.index, 10));
      });
    });
  }

  // Stats UI
  async updateStatsUI() {
    await this.loadStats();
    
    // Update stats elements with null checks
    const totalBlockedEl = document.getElementById('totalBlocked');
    const totalTimeEl = document.getElementById('totalTime');
    const totalDataEl = document.getElementById('totalData');
    
    if (totalBlockedEl) {
      totalBlockedEl.textContent = this.formatNumber(this.stats.blocked || 0);
    }
    if (totalTimeEl) {
      const seconds = (this.stats.blocked || 0) * 15; // Avg 15 sec per ad
      totalTimeEl.textContent = this.formatTime(seconds);
    }
    if (totalDataEl) {
      const mb = ((this.stats.blocked || 0) * 0.5).toFixed(1); // Avg 0.5 MB per ad
      totalDataEl.textContent = `${mb} MB`;
    }

    // Breakdown
    const breakdown = this.stats.breakdown || {};
    const total = Object.values(breakdown).reduce((a, b) => a + b, 0) || 1;

    const breakdownData = [
      { label: 'Video Ads', key: 'videoAds', color: '#EF4444' },
      { label: 'Banner Ads', key: 'bannerAds', color: '#F59E0B' },
      { label: 'Overlay Ads', key: 'overlayAds', color: '#10B981' },
      { label: 'Sponsored', key: 'sponsored', color: '#3B82F6' },
      { label: 'Tracking', key: 'tracking', color: '#8B5CF6' }
    ];

    const chartEl = document.querySelector('.breakdown-chart');
    if (chartEl) {
      chartEl.innerHTML = breakdownData.map(item => {
        const value = breakdown[item.key] || 0;
        const percent = Math.round((value / total) * 100) || 0;
        return `
          <div class="breakdown-row">
            <span class="breakdown-label">${item.label}</span>
            <div class="breakdown-bar">
              <div class="breakdown-fill" style="width: ${percent}%; background: ${item.color}"></div>
            </div>
            <span class="breakdown-value">${this.formatNumber(value)}</span>
          </div>
        `;
      }).join('');
    }
  }

  // Theme
  applyTheme() {
    const theme = this.settings.theme || 'system';
    const html = document.documentElement;
    
    html.classList.remove('light', 'dark');
    
    if (theme === 'dark') {
      html.classList.add('dark');
    } else if (theme === 'light') {
      html.classList.remove('dark');
    }
    // System theme is handled by media query
  }

  // Import/Export
  exportSettings() {
    const data = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      settings: this.settings,
      stats: this.stats
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `adeclipse-settings-${Date.now()}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
    this.showToast('Settings exported');
  }

  showImportDialog() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        
        if (data.settings) {
          this.settings = { ...this.getDefaultSettings(), ...data.settings };
          await this.saveSettings();
          this.populateUI();
          this.showToast('Settings imported');
        } else {
          this.showToast('Invalid settings file', 'error');
        }
      } catch (error) {
        console.error('Import error:', error);
        this.showToast('Failed to import settings', 'error');
      }
    });
    
    input.click();
  }

  async resetSettings() {
    if (!confirm('Are you sure you want to reset all settings to defaults?')) {
      return;
    }

    this.settings = this.getDefaultSettings();
    await this.saveSettings();
    this.populateUI();
    this.showToast('Settings reset to defaults');
  }

  async clearStats() {
    if (!confirm('Are you sure you want to clear all statistics?')) {
      return;
    }

    try {
      await chrome.runtime.sendMessage({ type: 'clearStats' });
      await this.loadStats();
      this.updateStatsUI();
      this.showToast('Statistics cleared');
    } catch (error) {
      console.error('Failed to clear stats:', error);
      this.showToast('Failed to clear statistics', 'error');
    }
  }

  // Utilities
  formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  formatTime(seconds) {
    if (seconds >= 3600) {
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${mins}m`;
    }
    if (seconds >= 60) {
      return `${Math.floor(seconds / 60)}m`;
    }
    return `${seconds}s`;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showToast(message, type = 'success') {
    // Remove existing toast
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 12px 24px;
      background: ${type === 'error' ? '#EF4444' : '#10B981'};
      color: white;
      border-radius: 8px;
      font-size: 14px;
      z-index: 10000;
      animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
  }
`;
document.head.appendChild(style);

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  window.optionsPage = new OptionsPage();
});
