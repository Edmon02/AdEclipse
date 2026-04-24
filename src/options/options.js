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
    await this.loadAIProviders();
    this.populateUI();
    this.applyTheme();
  }

  // Settings Management
  async loadSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      this.settings = this.deepMerge(this.getDefaultSettings(), response || {});
      this.normalizeSettingsShape();
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
      ai: {
        enabled: false,
        provider: 'openai',
        apiKey: '',
        model: '',
        customBaseUrl: '',
        customModelName: '',
        confidenceThreshold: 0.7,
        scanMode: 'smart',
        maxElementsPerBatch: 30,
        cacheDurationHours: 24,
        scanOnLoad: true,
        continuousScan: true,
        smoothRemoval: true,
        showAiBadge: true,
        usageStats: { totalTokens: 0, totalRequests: 0 }
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
        type: 'UPDATE_SETTINGS',
        data: this.settings
      });
      this.showToast('Settings saved');
    } catch (error) {
      console.error('Failed to save settings:', error);
      this.showToast('Failed to save settings', 'error');
    }
  }

  async loadStats() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
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

        if (target === 'stats') {
          this.updateStatsUI();
        }
        if (target === 'ai') {
          this.updateAIUsageStats();
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

    // AI Detection settings
    this.setupAISettings();

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

    // AI Detection
    this.populateAIUI();

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

    const whitelist = Array.isArray(this.settings.whitelist) ? this.settings.whitelist : [];

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

    const blacklist = Array.isArray(this.settings.blacklist) ? this.settings.blacklist : [];

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

  // AI Detection settings
  setupAISettings() {
    this.aiProviders = [];
    this.aiModels = [];
    this.highlightedModelIndex = -1;

    document.getElementById('aiEnabled')?.addEventListener('change', (e) => {
      if (!this.settings.ai) this.settings.ai = {};
      this.settings.ai.enabled = e.target.checked;
      this.updateAIVisibility();
      this.saveSettings();
    });

    document.getElementById('aiProvider')?.addEventListener('change', (e) => {
      this.settings.ai.provider = e.target.value;
      this.settings.ai.model = '';
      document.getElementById('aiModelSearch').value = '';
      document.getElementById('aiModel').value = '';
      this.updateCustomProviderVisibility();
      this.saveSettings();
      this.fetchAndPopulateModels(e.target.value);
    });

    document.getElementById('aiApiKey')?.addEventListener('input', (e) => {
      this.settings.ai.apiKey = e.target.value;
      this.updateApiKeyPreview();
      this.scheduleAISave();
    });
    document.getElementById('aiApiKey')?.addEventListener('change', (e) => {
      this.settings.ai.apiKey = e.target.value;
      this.updateApiKeyPreview();
      this.flushAISave();
    });

    document.getElementById('aiCustomBaseUrl')?.addEventListener('input', (e) => {
      this.settings.ai.customBaseUrl = e.target.value;
      this.scheduleAISave();
    });
    document.getElementById('aiCustomBaseUrl')?.addEventListener('change', (e) => {
      this.settings.ai.customBaseUrl = e.target.value;
      this.flushAISave();
    });

    document.getElementById('aiCustomModelName')?.addEventListener('input', (e) => {
      this.settings.ai.customModelName = e.target.value;
      this.settings.ai.model = e.target.value;
      this.scheduleAISave();
    });
    document.getElementById('aiCustomModelName')?.addEventListener('change', (e) => {
      this.settings.ai.customModelName = e.target.value;
      this.settings.ai.model = e.target.value;
      this.flushAISave();
    });

    document.getElementById('aiScanMode')?.addEventListener('change', (e) => {
      this.settings.ai.scanMode = e.target.value;
      this.saveSettings();
    });

    document.getElementById('aiConfidenceThreshold')?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      document.getElementById('aiConfidenceValue').textContent = val;
      this.settings.ai.confidenceThreshold = val / 100;
      this.saveSettings();
    });

    document.getElementById('aiScanOnLoad')?.addEventListener('change', (e) => {
      this.settings.ai.scanOnLoad = e.target.checked;
      this.saveSettings();
    });

    document.getElementById('aiContinuousScan')?.addEventListener('change', (e) => {
      this.settings.ai.continuousScan = e.target.checked;
      this.saveSettings();
    });

    document.getElementById('aiSmoothRemoval')?.addEventListener('change', (e) => {
      this.settings.ai.smoothRemoval = e.target.checked;
      this.saveSettings();
    });

    document.getElementById('aiMaxBatch')?.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val) && val >= 5 && val <= 60) {
        this.settings.ai.maxElementsPerBatch = val;
        this.saveSettings();
      }
    });

    document.getElementById('aiCacheDuration')?.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val) && val >= 1 && val <= 168) {
        this.settings.ai.cacheDurationHours = val;
        this.saveSettings();
      }
    });

    document.getElementById('toggleApiKeyVisibility')?.addEventListener('click', () => {
      const input = document.getElementById('aiApiKey');
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
      }
    });

    document.getElementById('aiTestConnection')?.addEventListener('click', () => this.testAIConnection());
    document.getElementById('aiClearCache')?.addEventListener('click', () => this.clearAICache());
    document.getElementById('aiRefreshModels')?.addEventListener('click', () => {
      this.fetchAndPopulateModels(this.settings.ai?.provider || 'openai', true);
    });

    this.setupModelPicker();
    window.addEventListener('beforeunload', () => this.flushAISave());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushAISave();
    });
  }

  scheduleAISave() {
    clearTimeout(this._aiSaveTimer);
    this._aiSaveTimer = setTimeout(() => this.saveSettings(), 180);
  }

  flushAISave() {
    clearTimeout(this._aiSaveTimer);
    this.saveSettings();
  }

  setupModelPicker() {
    const searchInput = document.getElementById('aiModelSearch');
    const dropdown = document.getElementById('aiModelDropdown');
    if (!searchInput || !dropdown) return;

    searchInput.addEventListener('focus', () => {
      this.renderModelDropdown(searchInput.value);
      dropdown.classList.add('visible');
    });

    searchInput.addEventListener('input', () => {
      this.highlightedModelIndex = -1;
      this.renderModelDropdown(searchInput.value);
      dropdown.classList.add('visible');
    });

    searchInput.addEventListener('keydown', (e) => {
      const items = dropdown.querySelectorAll('.model-option');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.highlightedModelIndex = Math.min(this.highlightedModelIndex + 1, items.length - 1);
        this.updateModelHighlight(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.highlightedModelIndex = Math.max(this.highlightedModelIndex - 1, 0);
        this.updateModelHighlight(items);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (this.highlightedModelIndex >= 0 && items[this.highlightedModelIndex]) {
          items[this.highlightedModelIndex].click();
        }
      } else if (e.key === 'Escape') {
        dropdown.classList.remove('visible');
        searchInput.blur();
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#aiModelPicker')) {
        dropdown.classList.remove('visible');
      }
    });
  }

  updateModelHighlight(items) {
    items.forEach((item, i) => {
      item.classList.toggle('highlighted', i === this.highlightedModelIndex);
    });
    if (this.highlightedModelIndex >= 0 && items[this.highlightedModelIndex]) {
      items[this.highlightedModelIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  renderModelDropdown(query) {
    const listEl = document.getElementById('aiModelList');
    const dropdown = document.getElementById('aiModelDropdown');
    if (!listEl) return;

    const q = (query || '').toLowerCase().trim();
    const filtered = q
      ? this.aiModels.filter(m =>
          m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
      : this.aiModels;

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="model-no-results">No models found</div>';
      const countEl = dropdown.querySelector('.model-count');
      if (countEl) countEl.remove();
      return;
    }

    const displayModels = filtered.slice(0, 100);
    const currentModel = this.settings.ai?.model || '';

    listEl.innerHTML = displayModels.map((m, i) => {
      const isSelected = m.id === currentModel;
      let priceHtml = '';
      if (m.pricing?.prompt) {
        const costPer1M = (parseFloat(m.pricing.prompt) * 1000000).toFixed(2);
        priceHtml = `<span class="model-option-price">$${costPer1M}/M</span>`;
      }
      return `<div class="model-option${isSelected ? ' selected' : ''}" data-model-id="${this.escapeHtml(m.id)}" data-model-name="${this.escapeHtml(m.name)}">
        <span class="model-option-name">${this.escapeHtml(m.name)}</span>
        ${m.name !== m.id ? `<span class="model-option-id">${this.escapeHtml(m.id)}</span>` : ''}
        ${priceHtml}
      </div>`;
    }).join('');

    let countEl = dropdown.querySelector('.model-count');
    if (!countEl) {
      countEl = document.createElement('div');
      countEl.className = 'model-count';
      dropdown.appendChild(countEl);
    }
    countEl.textContent = `${filtered.length} model${filtered.length !== 1 ? 's' : ''} available`;

    listEl.querySelectorAll('.model-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const modelId = opt.dataset.modelId;
        const modelName = opt.dataset.modelName;
        document.getElementById('aiModel').value = modelId;
        document.getElementById('aiModelSearch').value = modelName;
        this.settings.ai.model = modelId;
        this.saveSettings();
        dropdown.classList.remove('visible');
      });
    });
  }

  async loadAIProviders() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'AI_GET_PROVIDERS' });
      if (response?.providers) {
        this.aiProviders = response.providers;
      }
    } catch (e) {
      console.error('Failed to load AI providers:', e);
    }
  }

  async fetchAndPopulateModels(providerKey, forceRefresh = false) {
    const btn = document.getElementById('aiRefreshModels');
    const searchInput = document.getElementById('aiModelSearch');

    if (providerKey === 'custom') {
      this.aiModels = [];
      if (searchInput) searchInput.value = this.settings.ai?.customModelName || '';
      return;
    }

    if (btn) btn.classList.add('spinning');

    try {
      const apiKey = this.settings.ai?.apiKey || '';
      const response = await chrome.runtime.sendMessage({
        type: 'AI_FETCH_MODELS',
        data: { provider: providerKey, apiKey }
      });

      if (response?.models?.length > 0) {
        this.aiModels = response.models;
      } else {
        const provider = this.aiProviders.find(p => p.id === providerKey);
        this.aiModels = provider?.models || [];
      }
    } catch (e) {
      const provider = this.aiProviders.find(p => p.id === providerKey);
      this.aiModels = provider?.models || [];
    } finally {
      if (btn) btn.classList.remove('spinning');
    }

    const savedModel = this.settings.ai?.model;
    if (searchInput) {
      if (savedModel) {
        const match = this.aiModels.find(m => m.id === savedModel);
        searchInput.value = match ? match.name : savedModel;
      } else {
        searchInput.value = '';
      }
    }
  }

  updateCustomProviderVisibility() {
    const isCustom = this.settings.ai?.provider === 'custom';
    const urlRow = document.getElementById('aiCustomUrlRow');
    const modelRow = document.getElementById('aiCustomModelRow');
    if (urlRow) urlRow.style.display = isCustom ? '' : 'none';
    if (modelRow) modelRow.style.display = isCustom ? '' : 'none';
  }

  updateAIVisibility() {
    const enabled = this.settings.ai?.enabled;
    const groups = document.querySelectorAll('#aiProviderGroup, #aiScanGroup');
    groups.forEach(g => {
      g.style.opacity = enabled ? '1' : '0.5';
      g.style.pointerEvents = enabled ? '' : 'none';
    });
  }

  async testAIConnection() {
    const statusEl = document.getElementById('aiConnectionStatus');
    const btn = document.getElementById('aiTestConnection');
    if (!statusEl || !btn) return;

    btn.disabled = true;
    btn.textContent = 'Testing...';
    statusEl.textContent = 'Connecting...';
    statusEl.style.color = '';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'AI_TEST_CONNECTION',
        data: {
          provider: this.settings.ai?.provider || 'openai',
          apiKey: this.settings.ai?.apiKey || '',
          model: this.settings.ai?.model || '',
          customBaseUrl: this.settings.ai?.customBaseUrl || ''
        }
      });

      if (response?.success) {
        statusEl.textContent = `Connected to ${response.model || response.provider}`;
        statusEl.style.color = 'var(--success, #10B981)';
      } else {
        statusEl.textContent = `Failed: ${response?.error || 'Unknown error'}`;
        statusEl.style.color = 'var(--danger, #EF4444)';
      }
    } catch (error) {
      statusEl.textContent = `Error: ${error.message}`;
      statusEl.style.color = 'var(--danger, #EF4444)';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Test';
    }
  }

  async clearAICache() {
    try {
      await chrome.runtime.sendMessage({ type: 'AI_CLEAR_CACHE' });
      this.showToast('AI cache cleared');
      this.updateAIUsageStats();
    } catch (error) {
      this.showToast('Failed to clear cache', 'error');
    }
  }

  async updateAIUsageStats() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'AI_GET_USAGE' });
      if (response) {
        const { usage, cache } = response;
        const reqEl = document.getElementById('aiTotalRequests');
        const tokEl = document.getElementById('aiTotalTokens');
        const cacheEl = document.getElementById('aiCacheHits');
        const patternEl = document.getElementById('aiPatterns');

        if (reqEl) reqEl.textContent = this.formatNumber(usage?.totalRequests || 0);
        if (tokEl) tokEl.textContent = this.formatNumber(usage?.totalTokens || 0);
        if (cacheEl) cacheEl.textContent = this.formatNumber(cache?.memoryCacheSize || 0);
        if (patternEl) patternEl.textContent = this.formatNumber(cache?.patternCacheSize || 0);

        const statusEl = document.getElementById('aiCacheStatus');
        if (statusEl) {
          statusEl.textContent = `${cache?.memoryCacheSize || 0} cached entries, ${cache?.patternCacheSize || 0} learned patterns`;
        }
      }
    } catch (e) {
      // AI may not be initialized
    }
  }

  async populateAIUI() {
    const ai = this.settings.ai || {};

    this.setToggleValue('aiEnabled', ai.enabled);
    const normalizedProvider = ai.provider || 'openai';
    this.setSelectValue('aiProvider', normalizedProvider);

    const apiKeyInput = document.getElementById('aiApiKey');
    if (apiKeyInput) apiKeyInput.value = ai.apiKey || '';
    this.updateApiKeyPreview();

    const hiddenModelInput = document.getElementById('aiModel');
    if (hiddenModelInput) hiddenModelInput.value = ai.model || '';

    const customUrl = document.getElementById('aiCustomBaseUrl');
    if (customUrl) customUrl.value = ai.customBaseUrl || '';
    const customModel = document.getElementById('aiCustomModelName');
    if (customModel) customModel.value = ai.customModelName || '';

    this.updateCustomProviderVisibility();

    this.setSelectValue('aiScanMode', ai.scanMode || 'smart');

    const threshold = Math.round((ai.confidenceThreshold || 0.7) * 100);
    const rangeEl = document.getElementById('aiConfidenceThreshold');
    if (rangeEl) rangeEl.value = threshold;
    const valEl = document.getElementById('aiConfidenceValue');
    if (valEl) valEl.textContent = threshold;

    this.setToggleValue('aiScanOnLoad', ai.scanOnLoad !== false);
    this.setToggleValue('aiContinuousScan', ai.continuousScan !== false);
    this.setToggleValue('aiSmoothRemoval', ai.smoothRemoval !== false);

    const batchEl = document.getElementById('aiMaxBatch');
    if (batchEl) batchEl.value = ai.maxElementsPerBatch || 30;
    const cacheEl = document.getElementById('aiCacheDuration');
    if (cacheEl) cacheEl.value = ai.cacheDurationHours || 24;

    this.updateAIVisibility();
    this.updateAIUsageStats();

    const providerKey = normalizedProvider;
    if (providerKey !== 'custom') {
      await this.fetchAndPopulateModels(providerKey);
    } else {
      const searchInput = document.getElementById('aiModelSearch');
      if (searchInput) searchInput.value = ai.customModelName || ai.model || '';
    }
  }

  deepMerge(target, source) {
    if (!source || typeof source !== 'object') return target;
    const output = { ...target };

    for (const key of Object.keys(source)) {
      const srcVal = source[key];
      const tgtVal = output[key];
      if (
        srcVal &&
        typeof srcVal === 'object' &&
        !Array.isArray(srcVal) &&
        tgtVal &&
        typeof tgtVal === 'object' &&
        !Array.isArray(tgtVal)
      ) {
        output[key] = this.deepMerge(tgtVal, srcVal);
      } else {
        output[key] = srcVal;
      }
    }

    return output;
  }

  normalizeSettingsShape() {
    if (!this.settings || typeof this.settings !== 'object') {
      this.settings = this.getDefaultSettings();
      return;
    }

    // Legacy installs or malformed imports may store these as objects/strings.
    if (!Array.isArray(this.settings.whitelist)) {
      this.settings.whitelist = this.toArrayOrEmpty(this.settings.whitelist);
    }
    if (!Array.isArray(this.settings.blacklist)) {
      this.settings.blacklist = this.toArrayOrEmpty(this.settings.blacklist);
    }
    if (!Array.isArray(this.settings.customRules)) {
      this.settings.customRules = this.toArrayOrEmpty(this.settings.customRules);
    }

    if (!this.settings.ai || typeof this.settings.ai !== 'object') {
      this.settings.ai = this.getDefaultSettings().ai;
    }
    if (typeof this.settings.ai.provider !== 'string' || !this.settings.ai.provider) {
      this.settings.ai.provider = 'openai';
    }
    if (typeof this.settings.ai.apiKey !== 'string') {
      this.settings.ai.apiKey = '';
    }
    if (typeof this.settings.ai.model !== 'string') {
      this.settings.ai.model = '';
    }
    if (typeof this.settings.ai.customBaseUrl !== 'string') {
      this.settings.ai.customBaseUrl = '';
    }
    if (typeof this.settings.ai.customModelName !== 'string') {
      this.settings.ai.customModelName = '';
    }
  }

  toArrayOrEmpty(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    if (typeof value === 'string') return [value];
    if (typeof value === 'object') {
      return Object.values(value).filter(v => typeof v === 'string');
    }
    return [];
  }

  updateApiKeyPreview() {
    const preview = document.getElementById('aiApiKeyPreview');
    if (!preview) return;
    const key = this.settings?.ai?.apiKey || '';
    if (!key) {
      preview.textContent = 'No API key saved';
      return;
    }
    preview.textContent = `Saved key: ${this.maskApiKey(key)}`;
  }

  maskApiKey(key) {
    if (!key) return '';
    if (key.length <= 10) {
      return `${key.slice(0, 3)}...${key.slice(-2)}`;
    }
    const prefix = key.slice(0, 12);
    const suffix = key.slice(-3);
    return `${prefix}...${suffix}`;
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
      await chrome.runtime.sendMessage({ type: 'RESET_STATS' });
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
