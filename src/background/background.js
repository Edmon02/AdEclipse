/**
 * AdEclipse - Background Service Worker
 * Handles request blocking, stats tracking, and extension coordination
 */

// Import utilities
import { StorageManager } from './storage.js';
import { StatsTracker } from './stats.js';
import { RulesManager } from './rules.js';
import { AIAdDetector } from '../ml/ai-detector.js';
import { AIProvider } from '../ml/ai-provider.js';

// Initialize managers
const storage = new StorageManager();
const stats = new StatsTracker();
const rules = new RulesManager();

// AI detector (lazy-loaded when enabled)
let aiDetector = null;

// Debug mode flag
let DEBUG_MODE = false;

/**
 * Logger utility that respects debug mode
 */
const log = {
  debug: (...args) => DEBUG_MODE && console.log('[AdEclipse]', ...args),
  info: (...args) => console.info('[AdEclipse]', ...args),
  warn: (...args) => console.warn('[AdEclipse]', ...args),
  error: (...args) => console.error('[AdEclipse]', ...args)
};

/**
 * Extension initialization
 */
async function initialize() {
  log.info('Initializing AdEclipse...');
  
  try {
    // Load settings
    const settings = await storage.getSettings();
    DEBUG_MODE = settings.debugMode || false;
    
    // Initialize rules
    await rules.initialize();

    // Sync declarative rules based on enabled state
    await syncDeclarativeRules(settings.enabled);

    // Initialize AI detector if enabled
    await initAIDetector(settings);

    // Set up alarms for periodic tasks
    setupAlarms();
    
    // Update badge
    await updateBadge();
    
    log.info('AdEclipse initialized successfully');
  } catch (error) {
    log.error('Initialization error:', error);
  }
}

/**
 * Set up periodic alarms
 */
function setupAlarms() {
  // Update rules every 24 hours
  chrome.alarms.create('updateRules', { periodInMinutes: 1440 });
  
  // Sync stats every 5 minutes
  chrome.alarms.create('syncStats', { periodInMinutes: 5 });
}

/**
 * Initialize AI ad detector
 */
async function initAIDetector(settings) {
  if (!settings?.ai?.enabled || !settings.ai.apiKey) {
    aiDetector = null;
    return;
  }

  try {
    aiDetector = new AIAdDetector();
    await aiDetector.init(settings);
    log.info('AI detector initialized');
  } catch (error) {
    log.error('AI detector init failed:', error);
    aiDetector = null;
  }
}

// Listen for alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  log.debug('Alarm triggered:', alarm.name);
  
  switch (alarm.name) {
    case 'updateRules':
      await rules.checkForUpdates();
      break;
    case 'syncStats':
      await stats.sync();
      break;
  }
});

/**
 * Handle messages from content scripts and popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log.debug('Message received:', message.type, sender.tab?.id);
  
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(error => {
      log.error('Message handler error:', error);
      sendResponse({ success: false, error: error.message });
    });
  
  return true; // Keep channel open for async response
});

/**
 * Process incoming messages
 */
async function handleMessage(message, sender) {
  const { type, data } = message;
  
  switch (type) {
    case 'GET_SETTINGS':
      return await storage.getSettings();
    
    case 'UPDATE_SETTINGS':
      await storage.updateSettings(data);
      const updatedSettings = await storage.getSettings();
      await syncDeclarativeRules(updatedSettings.enabled);
      await initAIDetector(updatedSettings);
      await updateBadge();
      return { success: true };
    
    case 'GET_STATS':
      return await stats.getStats();
    
    case 'INCREMENT_BLOCKED':
      await stats.incrementBlocked(data.type, data.domain);
      await updateBadge(sender.tab?.id);
      return { success: true };
    
    case 'AD_SKIPPED':
      await stats.adSkipped(data.duration);
      return { success: true };
    
    case 'GET_SITE_ENABLED':
      const siteSettings = await storage.getSettings();
      const siteHostname = new URL(sender.url || sender.tab?.url).hostname;
      const isYouTubeSite = siteHostname.endsWith('youtube.com');

      // Determine if blocking is enabled for this site:
      // 1. Global must be enabled
      // 2. Site must NOT be whitelisted
      // 3. For non-YouTube sites in "manual" mode, site must be in blacklist
      let siteEnabled = siteSettings.enabled && !siteSettings.whitelist.includes(siteHostname);

      if (siteEnabled && !isYouTubeSite && siteSettings.websiteMode === 'manual') {
        // In manual mode, only block on explicitly listed sites
        const blacklist = siteSettings.blacklist || [];
        siteEnabled = blacklist.some(domain =>
          siteHostname === domain || siteHostname.endsWith('.' + domain)
        );
      }

      return {
        enabled: siteEnabled,
        mode: siteSettings.mode,
        blockTypes: siteSettings.blockTypes
      };
    
    case 'GET_SELECTORS':
      return await rules.getSelectorsForSite(data.hostname);
    
    case 'REPORT_BUG':
      return await handleBugReport(data);
    
    case 'TOGGLE_SITE':
      return await toggleSiteBlocking(data.hostname, data.enabled);
    
    case 'EXPORT_SETTINGS':
      return await storage.exportAll();
    
    case 'IMPORT_SETTINGS':
      await storage.importAll(data);
      return { success: true };
    
    case 'RESET_STATS':
      await stats.reset();
      return { success: true };
    
    case 'GET_CUSTOM_RULES':
      return await storage.getCustomRules();
    
    case 'SAVE_CUSTOM_RULES':
      await storage.saveCustomRules(data);
      await rules.reloadRules();
      return { success: true };

    // AI Detection handlers
    case 'AI_SCAN_ELEMENTS':
      return await handleAIScan(data);

    case 'AI_GET_CONFIG': {
      const aiSettings = await storage.getSettings();
      const ai = aiSettings.ai || {};
      return {
        enabled: ai.enabled && !!ai.apiKey,
        scanMode: ai.scanMode || 'smart',
        smoothRemoval: ai.smoothRemoval !== false,
        debugMode: aiSettings.debugMode || false,
        confidenceThreshold: ai.confidenceThreshold ?? 0.7,
        scanOnLoad: ai.scanOnLoad !== false,
        continuousScan: ai.continuousScan !== false
      };
    }

    case 'AI_TEST_CONNECTION': {
      try {
        const testProvider = new AIProvider();
        testProvider.configure(data);
        return await testProvider.testConnection();
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    case 'AI_GET_PROVIDERS':
      return { providers: AIProvider.getProviders() };

    case 'AI_FETCH_MODELS': {
      try {
        const models = await AIProvider.fetchRemoteModels(data.provider, data.apiKey);
        return { models };
      } catch (error) {
        return { models: [], error: error.message };
      }
    }

    case 'AI_GET_USAGE':
      return {
        usage: aiDetector ? aiDetector.getUsageStats() : { totalTokens: 0, totalRequests: 0 },
        cache: aiDetector ? aiDetector.getCacheStats() : { memoryCacheSize: 0, patternCacheSize: 0 }
      };

    case 'AI_CLEAR_CACHE':
      if (aiDetector) aiDetector.clearCache();
      return { success: true };
    
    default:
      log.warn('Unknown message type:', type);
      return { success: false, error: 'Unknown message type' };
  }
}

/**
 * Handle AI scan request from content script
 */
async function handleAIScan(data) {
  if (!aiDetector) {
    const settings = await storage.getSettings();
    if (settings?.ai?.enabled && settings.ai.apiKey) {
      await initAIDetector(settings);
    }
    if (!aiDetector) {
      return { results: [], error: 'AI detector not available' };
    }
  }

  try {
    const results = await aiDetector.scanElements(data.elements, data.domain);
    return { results };
  } catch (error) {
    log.error('AI scan error:', error);
    return { results: [], error: error.message };
  }
}

/**
 * Toggle blocking for a specific site
 */
async function toggleSiteBlocking(hostname, enabled) {
  const settings = await storage.getSettings();
  
  if (enabled) {
    // Remove from whitelist
    settings.whitelist = settings.whitelist.filter(h => h !== hostname);
  } else {
    // Add to whitelist
    if (!settings.whitelist.includes(hostname)) {
      settings.whitelist.push(hostname);
    }
  }
  
  await storage.updateSettings({ whitelist: settings.whitelist });
  return { success: true, whitelist: settings.whitelist };
}

/**
 * Handle bug reports
 */
async function handleBugReport(data) {
  const reportData = {
    timestamp: new Date().toISOString(),
    version: chrome.runtime.getManifest().version,
    userAgent: data.userAgent,
    url: data.url,
    description: data.description,
    logs: DEBUG_MODE ? data.logs : '[Debug mode disabled]'
  };
  
  log.info('Bug report generated:', reportData);
  
  // In production, this would send to a server
  // For now, just log it
  return {
    success: true,
    reportId: `AE-${Date.now()}`
  };
}

/**
 * Enable or disable declarativeNetRequest rulesets based on global toggle
 */
async function syncDeclarativeRules(enabled) {
  try {
    if (enabled) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: ['adblock_rules']
      });
    } else {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        disableRulesetIds: ['adblock_rules']
      });
    }
    log.debug('Declarative rules', enabled ? 'enabled' : 'disabled');
  } catch (error) {
    log.error('Failed to toggle declarative rules:', error);
  }
}

/**
 * Update extension badge
 */
async function updateBadge(tabId) {
  try {
    const settings = await storage.getSettings();
    const todayStats = await stats.getTodayStats();
    
    if (!settings.enabled) {
      await chrome.action.setBadgeText({ text: 'OFF', tabId });
      await chrome.action.setBadgeBackgroundColor({ color: '#6B7280', tabId });
    } else {
      const count = todayStats.adsBlocked;
      const text = count > 999 ? '999+' : count.toString();
      await chrome.action.setBadgeText({ text, tabId });
      await chrome.action.setBadgeBackgroundColor({ color: '#10B981', tabId });
    }
  } catch (error) {
    log.error('Badge update error:', error);
  }
}

/**
 * Handle tab updates - inject content scripts conditionally
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url) {
    try {
      // Skip non-http pages (chrome://, about:, chrome-extension://, etc.)
      if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) {
        return;
      }

      const settings = await storage.getSettings();
      const url = new URL(tab.url);
      const hostname = url.hostname;
      const isYouTube = hostname.endsWith('youtube.com');
      let isEnabled = settings.enabled && !settings.whitelist?.includes(hostname);

      // For non-YouTube sites in manual mode, check if the site is in the blacklist
      if (isEnabled && !isYouTube && settings.websiteMode === 'manual') {
        const blacklist = settings.blacklist || [];
        isEnabled = blacklist.some(domain =>
          hostname === domain || hostname.endsWith('.' + domain)
        );
      }

      // Only inject scripts when the extension is enabled for this site
      if (isEnabled) {
        if (isYouTube && settings.youtube?.enabled !== false) {
          // Inject YouTube main-world script
          chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ['src/content/youtube-mainworld.js'],
            world: 'MAIN',
            injectImmediately: true
          }).catch(() => {});

          // Inject YouTube isolated-world script + CSS
          chrome.scripting.insertCSS({
            target: { tabId, allFrames: true },
            files: ['src/content/youtube.css']
          }).catch(() => {});

          chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ['src/content/youtube-utils.js', 'src/content/youtube.js'],
            injectImmediately: true
          }).catch(() => {});
        } else if (!isYouTube) {
          // Inject general ad-blocking CSS + JS for non-YouTube sites
          chrome.scripting.insertCSS({
            target: { tabId, allFrames: true },
            files: ['src/content/general.css']
          }).catch(() => {});

          chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ['src/content/general.js'],
            injectImmediately: true
          }).catch(() => {});
        }

        // Inject anti-adblock on all sites
        chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          files: ['src/content/anti-adblock.js'],
          injectImmediately: true
        }).catch(() => {});

        // Inject AI scanner and video ad interceptor if enabled
        if (settings.ai?.enabled && settings.ai.apiKey) {
          chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ['src/content/player-mainworld-patch.js'],
            world: 'MAIN',
            injectImmediately: true
          }).catch(() => {});

          chrome.scripting.insertCSS({
            target: { tabId, allFrames: true },
            files: ['src/content/ai-scanner.css']
          }).catch(() => {});

          chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ['src/content/ai-scanner.js'],
            injectImmediately: true
          }).catch(() => {});

          chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ['src/content/video-ad-interceptor.js'],
            injectImmediately: true
          }).catch(() => {});
        }
      }
    } catch (error) {
      log.debug('Script injection error:', error.message);
    }
  }

  if (changeInfo.status === 'complete' && tab.url) {
    await updateBadge(tabId);
  }
});

/**
 * Handle extension install/update
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  log.info('Extension installed/updated:', details.reason);
  
  if (details.reason === 'install') {
    // Set default settings
    await storage.initializeDefaults();
    
    // Open welcome page
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/options/options.html?welcome=true')
    });
  } else if (details.reason === 'update') {
    // Check for rule updates
    await rules.checkForUpdates();
  }
  
  await initialize();
});

/**
 * Handle extension startup (browser restart)
 */
chrome.runtime.onStartup.addListener(async () => {
  await initialize();
});

/**
 * Listen for declarativeNetRequest blocked events (for stats)
 */
if (chrome.declarativeNetRequest?.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    log.debug('Rule matched:', info.rule.ruleId, info.request.url);
    stats.incrementBlocked('network', new URL(info.request.url).hostname);
  });
}

/**
 * Context menu for quick actions
 */
chrome.runtime.onInstalled.addListener(() => {
  // Only create context menus if the API is available
  if (chrome.contextMenus) {
    try {
      chrome.contextMenus.create({
        id: 'adeclipse-toggle',
        title: 'Toggle AdEclipse on this site',
        contexts: ['page']
      });
      
      chrome.contextMenus.create({
        id: 'adeclipse-report',
        title: 'Report missed ad',
        contexts: ['page', 'image', 'video']
      });
    } catch (error) {
      console.warn('[AdEclipse] Could not create context menus:', error);
    }
  }
});

if (chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    try {
      if (info.menuItemId === 'adeclipse-toggle') {
        const hostname = new URL(tab.url).hostname;
        const settings = await storage.getSettings();
        const isWhitelisted = settings.whitelist?.includes(hostname) || false;
        await toggleSiteBlocking(hostname, isWhitelisted);
        
        // Reload the tab
        chrome.tabs.reload(tab.id);
      } else if (info.menuItemId === 'adeclipse-report') {
        // Open report dialog
        chrome.tabs.sendMessage(tab.id, { type: 'SHOW_REPORT_DIALOG' });
      }
    } catch (error) {
      log.error('Context menu click error:', error);
    }
  });
}

// Initialize on load
initialize();
