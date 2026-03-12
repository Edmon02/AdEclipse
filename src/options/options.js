/**
 * AdEclipse Options Page
 * Settings management and UI interactions
 */

class OptionsPage {
  constructor() {
    this.settings = null;
    this.stats = null;
    this.customRules = { domains: [], selectors: {} };
    this.init();
  }

  async init() {
    await Promise.all([
      this.loadSettings(),
      this.loadStats(),
      this.loadCustomRules()
    ]);

    this.setupNavigation();
    this.setupEventListeners();
    this.populateUI();
    this.applyTheme();
  }

  async loadSettings() {
    try {
      this.settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    } catch (error) {
      console.error('Failed to load settings:', error);
      this.settings = this.getDefaultSettings();
    }
  }

  async loadStats() {
    try {
      this.stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
    } catch (error) {
      console.error('Failed to load stats:', error);
      this.stats = {
        allTime: {
          adsBlocked: 0,
          timeSaved: 0,
          dataSaved: 0,
          byType: {}
        }
      };
    }
  }

  async loadCustomRules() {
    try {
      this.customRules = await chrome.runtime.sendMessage({ type: 'GET_CUSTOM_RULES' });
    } catch (error) {
      console.error('Failed to load custom rules:', error);
      this.customRules = { domains: [], selectors: {} };
    }
  }

  getDefaultSettings() {
    return {
      enabled: true,
      mode: 'balanced',
      blockTypes: {
        videoAds: true,
        bannerAds: true,
        sponsoredContent: true,
        popups: true,
        trackers: true,
        cookieBanners: false
      },
      youtube: {
        enabled: true,
        autoSkip: true,
        speedUpAds: true,
        muteAds: true,
        blockOverlays: true,
        blockMasthead: true,
        blockSponsored: true,
        blockMerch: true
      },
      enabledSites: [],
      performance: {
        lazyLoad: true,
        cacheEnabled: true,
        debounceMs: 100,
        useML: false
      },
      ui: {
        darkMode: 'auto',
        showBadge: true
      },
      updates: {
        autoUpdate: true,
        lastUpdate: null
      },
      debugMode: false
    };
  }

  async persistSettings() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        data: this.settings
      });

      this.settings = response?.settings || this.settings;
      this.populateUI();
      this.applyTheme();
    } catch (error) {
      console.error('Failed to save settings:', error);
      this.showToast('Failed to save settings', 'error');
    }
  }

  setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.settings-section');

    navItems.forEach((item) => {
      item.addEventListener('click', (event) => {
        event.preventDefault();

        const target = item.dataset.section;
        navItems.forEach((nav) => nav.classList.remove('active'));
        sections.forEach((section) => section.classList.remove('active'));

        item.classList.add('active');
        document.getElementById(target)?.classList.add('active');

        if (target === 'stats') {
          this.updateStatsUI();
        }
      });
    });
  }

  setupEventListeners() {
    this.bindToggle('enabledToggle', 'enabled');
    this.bindSelect('modeSelect', 'mode');
    this.bindSelect('themeSelect', ['ui', 'darkMode']);
    this.bindToggle('showBadge', ['ui', 'showBadge']);

    this.bindToggle('blockVideo', ['blockTypes', 'videoAds']);
    this.bindToggle('blockBanner', ['blockTypes', 'bannerAds']);
    this.bindToggle('blockSponsored', ['blockTypes', 'sponsoredContent']);
    this.bindToggle('blockPopups', ['blockTypes', 'popups']);
    this.bindToggle('blockTrackers', ['blockTypes', 'trackers']);
    this.bindToggle('blockCookies', ['blockTypes', 'cookieBanners']);

    this.bindToggle('ytEnabled', ['youtube', 'enabled']);
    this.bindToggle('ytAutoSkip', ['youtube', 'autoSkip']);
    this.bindToggle('ytSpeedUp', ['youtube', 'speedUpAds']);
    this.bindToggle('ytMute', ['youtube', 'muteAds']);
    this.bindToggle('ytOverlays', ['youtube', 'blockOverlays']);
    this.bindToggle('ytMasthead', ['youtube', 'blockMasthead']);
    this.bindToggle('ytSponsored', ['youtube', 'blockSponsored']);
    this.bindToggle('ytMerch', ['youtube', 'blockMerch']);

    this.bindToggle('lazyLoad', ['performance', 'lazyLoad']);
    this.bindToggle('cacheEnabled', ['performance', 'cacheEnabled']);
    this.bindNumber('debounceMs', ['performance', 'debounceMs']);
    this.bindToggle('useML', ['performance', 'useML']);
    this.bindToggle('autoUpdate', ['updates', 'autoUpdate']);
    this.bindToggle('debugMode', 'debugMode');

    const websiteModeSelect = document.getElementById('websiteModeSelect');
    if (websiteModeSelect) {
      websiteModeSelect.disabled = true;
      websiteModeSelect.addEventListener('change', () => {
        websiteModeSelect.value = 'explicit';
      });
    }

    document.getElementById('addBlacklist')?.addEventListener('click', () => this.addEnabledSite());
    document.getElementById('blacklistInput')?.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') {
        this.addEnabledSite();
      }
    });

    document.getElementById('addCustomRule')?.addEventListener('click', () => this.addCustomRule());
    document.getElementById('customSelector')?.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') {
        this.addCustomRule();
      }
    });

    document.getElementById('resetStats')?.addEventListener('click', () => this.resetStats());
    document.getElementById('checkUpdates')?.addEventListener('click', () => this.checkForRuleUpdates());
    document.getElementById('exportSettings')?.addEventListener('click', () => this.exportSettings());
    document.getElementById('importSettings')?.addEventListener('click', () => {
      document.getElementById('importFile')?.click();
    });
    document.getElementById('importFile')?.addEventListener('change', (event) => this.importSettings(event));

    document.getElementById('themeSelect')?.addEventListener('change', () => this.applyTheme());
  }

  bindToggle(elementId, settingPath) {
    const element = document.getElementById(elementId);
    if (!element) return;

    element.addEventListener('change', async () => {
      this.setSetting(settingPath, element.checked);
      await this.persistSettings();
    });
  }

  bindSelect(elementId, settingPath) {
    const element = document.getElementById(elementId);
    if (!element) return;

    element.addEventListener('change', async () => {
      this.setSetting(settingPath, element.value);
      await this.persistSettings();
    });
  }

  bindNumber(elementId, settingPath) {
    const element = document.getElementById(elementId);
    if (!element) return;

    element.addEventListener('change', async () => {
      const nextValue = parseInt(element.value, 10);
      if (Number.isNaN(nextValue)) {
        return;
      }

      this.setSetting(settingPath, nextValue);
      await this.persistSettings();
    });
  }

  getSetting(path) {
    if (typeof path === 'string') {
      return this.settings?.[path];
    }

    return path.reduce((value, key) => value?.[key], this.settings);
  }

  setSetting(path, value) {
    if (typeof path === 'string') {
      this.settings[path] = value;
      return;
    }

    let cursor = this.settings;
    for (let index = 0; index < path.length - 1; index += 1) {
      const key = path[index];
      if (!cursor[key] || typeof cursor[key] !== 'object') {
        cursor[key] = {};
      }
      cursor = cursor[key];
    }

    cursor[path[path.length - 1]] = value;
  }

  normalizeHostname(input) {
    if (!input) return '';

    try {
      return new URL(input).hostname.replace(/^www\./, '').toLowerCase();
    } catch (_) {
      return String(input)
        .trim()
        .toLowerCase()
        .replace(/^[a-z]+:\/\//, '')
        .replace(/^www\./, '')
        .split('/')[0]
        .split(':')[0]
        .replace(/\.+$/, '');
    }
  }

  populateUI() {
    this.setToggleValue('enabledToggle', this.settings.enabled);
    this.setSelectValue('modeSelect', this.settings.mode);
    this.setSelectValue('themeSelect', this.settings.ui?.darkMode || 'auto');
    this.setToggleValue('showBadge', this.settings.ui?.showBadge);

    this.setToggleValue('blockVideo', this.settings.blockTypes?.videoAds);
    this.setToggleValue('blockBanner', this.settings.blockTypes?.bannerAds);
    this.setToggleValue('blockSponsored', this.settings.blockTypes?.sponsoredContent);
    this.setToggleValue('blockPopups', this.settings.blockTypes?.popups);
    this.setToggleValue('blockTrackers', this.settings.blockTypes?.trackers);
    this.setToggleValue('blockCookies', this.settings.blockTypes?.cookieBanners);

    this.setToggleValue('ytEnabled', this.settings.youtube?.enabled);
    this.setToggleValue('ytAutoSkip', this.settings.youtube?.autoSkip);
    this.setToggleValue('ytSpeedUp', this.settings.youtube?.speedUpAds);
    this.setToggleValue('ytMute', this.settings.youtube?.muteAds);
    this.setToggleValue('ytOverlays', this.settings.youtube?.blockOverlays);
    this.setToggleValue('ytMasthead', this.settings.youtube?.blockMasthead);
    this.setToggleValue('ytSponsored', this.settings.youtube?.blockSponsored);
    this.setToggleValue('ytMerch', this.settings.youtube?.blockMerch);

    this.setToggleValue('lazyLoad', this.settings.performance?.lazyLoad);
    this.setToggleValue('cacheEnabled', this.settings.performance?.cacheEnabled);
    this.setNumberValue('debounceMs', this.settings.performance?.debounceMs);
    this.setToggleValue('useML', this.settings.performance?.useML);
    this.setToggleValue('autoUpdate', this.settings.updates?.autoUpdate);
    this.setToggleValue('debugMode', this.settings.debugMode);

    this.setSelectValue('websiteModeSelect', 'explicit');
    document.getElementById('lastUpdateTime').textContent = this.settings.updates?.lastUpdate || 'Never';

    this.renderEnabledSites();
    this.renderCustomRules();
    this.updateStatsUI();
  }

  setToggleValue(elementId, value) {
    const element = document.getElementById(elementId);
    if (element) {
      element.checked = !!value;
    }
  }

  setSelectValue(elementId, value) {
    const element = document.getElementById(elementId);
    if (element && value !== undefined) {
      element.value = value;
    }
  }

  setNumberValue(elementId, value) {
    const element = document.getElementById(elementId);
    if (element && value !== undefined) {
      element.value = value;
    }
  }

  async addEnabledSite() {
    const input = document.getElementById('blacklistInput');
    const domain = this.normalizeHostname(input?.value);

    if (!domain) {
      return;
    }

    const nextSites = new Set(this.settings.enabledSites || []);
    nextSites.add(domain);
    this.settings.enabledSites = [...nextSites];
    input.value = '';

    await this.persistSettings();
    this.showToast(`Added ${domain}`);
  }

  async removeEnabledSite(domain) {
    this.settings.enabledSites = (this.settings.enabledSites || []).filter((item) => item !== domain);
    await this.persistSettings();
  }

  renderEnabledSites() {
    const list = document.getElementById('blacklistItems');
    if (!list) return;

    const enabledSites = this.settings.enabledSites || [];
    if (enabledSites.length === 0) {
      list.innerHTML = '<li class="site-list-item"><span style="color: var(--text-muted)">No sites added yet</span></li>';
      return;
    }

    list.innerHTML = enabledSites.map((domain) => `
      <li class="site-list-item">
        <span>${this.escapeHtml(domain)}</span>
        <button class="remove-btn" data-domain="${this.escapeHtml(domain)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </li>
    `).join('');

    list.querySelectorAll('.remove-btn').forEach((button) => {
      button.addEventListener('click', () => {
        this.removeEnabledSite(button.dataset.domain);
      });
    });
  }

  async addCustomRule() {
    const domainInput = document.getElementById('customDomain');
    const selectorInput = document.getElementById('customSelector');
    const domain = this.normalizeHostname(domainInput?.value);
    const selector = selectorInput?.value.trim();

    if (!domain || !selector) {
      this.showToast('Enter both domain and selector', 'error');
      return;
    }

    try {
      document.querySelector(selector);
    } catch (error) {
      this.showToast('Invalid CSS selector', 'error');
      return;
    }

    const selectors = this.customRules.selectors || {};
    const existing = selectors[domain]?.custom || [];
    selectors[domain] = {
      custom: [...new Set([...existing, selector])]
    };

    this.customRules = {
      domains: [...new Set([...(this.customRules.domains || []), domain])],
      selectors
    };

    await this.saveCustomRules();
    domainInput.value = '';
    selectorInput.value = '';
  }

  async saveCustomRules() {
    try {
      await chrome.runtime.sendMessage({
        type: 'SAVE_CUSTOM_RULES',
        data: this.customRules
      });
      this.renderCustomRules();
      this.showToast('Custom rules saved');
    } catch (error) {
      console.error('Failed to save custom rules:', error);
      this.showToast('Failed to save custom rules', 'error');
    }
  }

  async removeCustomRule(domain, selector) {
    const currentSelectors = this.customRules.selectors?.[domain]?.custom || [];
    const nextSelectors = currentSelectors.filter((item) => item !== selector);

    if (nextSelectors.length === 0) {
      delete this.customRules.selectors[domain];
      this.customRules.domains = (this.customRules.domains || []).filter((item) => item !== domain);
    } else {
      this.customRules.selectors[domain] = { custom: nextSelectors };
    }

    await this.saveCustomRules();
  }

  renderCustomRules() {
    const list = document.getElementById('customRulesList');
    if (!list) return;

    const entries = [];
    for (const [domain, groups] of Object.entries(this.customRules.selectors || {})) {
      for (const selector of groups.custom || []) {
        entries.push({ domain, selector });
      }
    }

    if (entries.length === 0) {
      list.innerHTML = '<li class="rule-list-item"><span style="color: var(--text-muted)">No custom rules</span></li>';
      return;
    }

    list.innerHTML = entries.map(({ domain, selector }) => `
      <li class="rule-list-item">
        <span>${this.escapeHtml(domain)}: ${this.escapeHtml(selector)}</span>
        <button class="remove-btn" data-domain="${this.escapeHtml(domain)}" data-selector="${this.escapeHtml(selector)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </li>
    `).join('');

    list.querySelectorAll('.remove-btn').forEach((button) => {
      button.addEventListener('click', () => {
        this.removeCustomRule(button.dataset.domain, button.dataset.selector);
      });
    });
  }

  async updateStatsUI() {
    await this.loadStats();

    const allTime = this.stats?.allTime || {
      adsBlocked: 0,
      timeSaved: 0,
      dataSaved: 0,
      byType: {}
    };
    const byType = allTime.byType || {};

    document.getElementById('totalBlocked').textContent = this.formatNumber(allTime.adsBlocked || 0);
    document.getElementById('totalTime').textContent = this.formatTime(allTime.timeSaved || 0);
    document.getElementById('totalData').textContent = this.formatData(allTime.dataSaved || 0);

    const breakdown = {
      video: byType.videoAd || 0,
      banner: byType.bannerAd || 0,
      network: byType.network || 0,
      other: (byType.overlay || 0) + (byType.popup || 0) + (byType.sponsored || 0)
    };

    const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0) || 1;
    this.updateBreakdownRow('video', breakdown.video, total);
    this.updateBreakdownRow('banner', breakdown.banner, total);
    this.updateBreakdownRow('network', breakdown.network, total);
    this.updateBreakdownRow('other', breakdown.other, total);
  }

  updateBreakdownRow(prefix, count, total) {
    document.getElementById(`${prefix}Count`).textContent = this.formatNumber(count);
    document.getElementById(`${prefix}Bar`).style.width = `${Math.round((count / total) * 100)}%`;
  }

  applyTheme() {
    const theme = this.settings?.ui?.darkMode || 'auto';
    const html = document.documentElement;

    html.classList.remove('light', 'dark');
    if (theme === 'dark') {
      html.classList.add('dark');
    } else if (theme === 'light') {
      html.classList.add('light');
    }
  }

  async checkForRuleUpdates() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CHECK_RULE_UPDATES' });
      this.settings.updates.lastUpdate = response?.lastUpdate || new Date().toISOString();
      document.getElementById('lastUpdateTime').textContent = this.settings.updates.lastUpdate;
      this.showToast('Rules check completed');
    } catch (error) {
      console.error('Failed to check for updates:', error);
      this.showToast('Failed to check for updates', 'error');
    }
  }

  async resetStats() {
    if (!confirm('Are you sure you want to reset all statistics?')) {
      return;
    }

    try {
      await chrome.runtime.sendMessage({ type: 'RESET_STATS' });
      await this.updateStatsUI();
      this.showToast('Statistics reset');
    } catch (error) {
      console.error('Failed to reset stats:', error);
      this.showToast('Failed to reset statistics', 'error');
    }
  }

  async exportSettings() {
    try {
      const payload = await chrome.runtime.sendMessage({ type: 'EXPORT_SETTINGS' });
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `adeclipse-settings-${Date.now()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      this.showToast('Settings exported');
    } catch (error) {
      console.error('Failed to export settings:', error);
      this.showToast('Failed to export settings', 'error');
    }
  }

  async importSettings(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await chrome.runtime.sendMessage({
        type: 'IMPORT_SETTINGS',
        data
      });

      await Promise.all([
        this.loadSettings(),
        this.loadCustomRules()
      ]);
      this.populateUI();
      this.applyTheme();
      this.showToast('Settings imported');
    } catch (error) {
      console.error('Failed to import settings:', error);
      this.showToast('Failed to import settings', 'error');
    } finally {
      event.target.value = '';
    }
  }

  formatNumber(value) {
    return Number(value || 0).toLocaleString();
  }

  formatTime(seconds) {
    const totalSeconds = Math.round(seconds || 0);
    if (totalSeconds < 60) return `${totalSeconds}s`;
    if (totalSeconds < 3600) {
      const minutes = Math.floor(totalSeconds / 60);
      const remainder = totalSeconds % 60;
      return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.round((totalSeconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }

  formatData(kb) {
    const value = Number(kb || 0);
    if (value < 1024) return `${Math.round(value)} KB`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} MB`;
    return `${(value / (1024 * 1024)).toFixed(2)} GB`;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showToast(message, type = 'success') {
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

document.addEventListener('DOMContentLoaded', () => {
  window.optionsPage = new OptionsPage();
});
