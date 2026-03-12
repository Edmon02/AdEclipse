/**
 * AdEclipse - Background Service Worker
 * Handles request blocking, stats tracking, and extension coordination
 */

import { StorageManager } from './storage.js';
import { StatsTracker } from './stats.js';
import { RulesManager } from './rules.js';
import { isSiteEnabled, listHasMatchingHostname, normalizeHostname } from './site-utils.js';

const storage = new StorageManager();
const stats = new StatsTracker();
const rules = new RulesManager();

let DEBUG_MODE = false;
let bundledNetworkRules = null;

const log = {
  debug: (...args) => DEBUG_MODE && console.log('[AdEclipse]', ...args),
  info: (...args) => console.info('[AdEclipse]', ...args),
  warn: (...args) => console.warn('[AdEclipse]', ...args),
  error: (...args) => console.error('[AdEclipse]', ...args)
};

async function initialize() {
  log.info('Initializing AdEclipse...');

  try {
    const settings = await storage.getSettings();
    DEBUG_MODE = settings.debugMode || false;

    await rules.initialize();
    await syncScopedNetworkRules(settings);
    setupAlarms();
    await updateBadge();

    log.info('AdEclipse initialized successfully');
  } catch (error) {
    log.error('Initialization error:', error);
  }
}

function setupAlarms() {
  chrome.alarms.create('updateRules', { periodInMinutes: 1440 });
  chrome.alarms.create('syncStats', { periodInMinutes: 5 });
}

async function getBundledNetworkRules(forceReload = false) {
  if (bundledNetworkRules && !forceReload) {
    return bundledNetworkRules;
  }

  try {
    const response = await fetch(chrome.runtime.getURL('rules/declarative_rules.json'));
    bundledNetworkRules = await response.json();
    return bundledNetworkRules;
  } catch (error) {
    log.error('Failed to load bundled network rules:', error);
    return [];
  }
}

async function getCurrentScopedRules() {
  if (chrome.declarativeNetRequest?.getSessionRules) {
    return chrome.declarativeNetRequest.getSessionRules();
  }

  if (chrome.declarativeNetRequest?.getDynamicRules) {
    return chrome.declarativeNetRequest.getDynamicRules();
  }

  return [];
}

async function updateScopedRules(payload) {
  if (chrome.declarativeNetRequest?.updateSessionRules) {
    return chrome.declarativeNetRequest.updateSessionRules(payload);
  }

  if (chrome.declarativeNetRequest?.updateDynamicRules) {
    return chrome.declarativeNetRequest.updateDynamicRules(payload);
  }

  return undefined;
}

async function syncScopedNetworkRules(settings, forceReload = false) {
  try {
    const activeRules = await getCurrentScopedRules();
    const removeRuleIds = activeRules.map((rule) => rule.id);
    const enabledSites = settings?.enabled ? settings.enabledSites || [] : [];
    let addRules = [];

    if (enabledSites.length > 0) {
      const baseRules = await getBundledNetworkRules(forceReload);
      addRules = baseRules.map((rule) => ({
        ...rule,
        condition: {
          ...rule.condition,
          initiatorDomains: enabledSites
        }
      }));
    }

    await updateScopedRules({
      removeRuleIds,
      addRules
    });

    log.debug('Scoped network rules synced', addRules.length);
  } catch (error) {
    log.error('Failed to sync scoped network rules:', error);
  }
}

function isYouTubeHost(hostname) {
  return normalizeHostname(hostname).endsWith('youtube.com');
}

function getSiteStatus(hostname, settings) {
  const normalizedHostname = normalizeHostname(hostname);
  const added = listHasMatchingHostname(normalizedHostname, settings.enabledSites || []);
  const enabled = added && settings.enabled && (!isYouTubeHost(normalizedHostname) || settings.youtube?.enabled !== false);

  return {
    hostname: normalizedHostname,
    added,
    enabled
  };
}

async function handleMessage(message, sender) {
  const { type, data } = message;

  switch (type) {
    case 'GET_SETTINGS':
      return storage.getSettings();

    case 'UPDATE_SETTINGS': {
      await storage.updateSettings(data);
      const updatedSettings = await storage.getSettings();
      await syncScopedNetworkRules(updatedSettings);
      await updateBadge();
      return { success: true, settings: updatedSettings };
    }

    case 'GET_STATS':
      return stats.getStats();

    case 'INCREMENT_BLOCKED':
      await stats.incrementBlocked(data.type, data.domain);
      await updateBadge(sender.tab?.id);
      return { success: true };

    case 'AD_SKIPPED':
      await stats.adSkipped(data.duration);
      return { success: true };

    case 'GET_SITE_ENABLED': {
      const siteSettings = await storage.getSettings();
      const siteSource = data?.hostname || sender.url || sender.tab?.url || '';
      const status = getSiteStatus(siteSource, siteSettings);

      return {
        enabled: status.enabled,
        added: status.added,
        hostname: status.hostname,
        mode: siteSettings.mode,
        blockTypes: siteSettings.blockTypes
      };
    }

    case 'GET_SELECTORS':
      return rules.getSelectorsForSite(data.hostname);

    case 'REPORT_BUG':
      return handleBugReport(data);

    case 'TOGGLE_SITE':
      return toggleSiteBlocking(data.hostname, data.enabled);

    case 'EXPORT_SETTINGS':
      return storage.exportAll();

    case 'IMPORT_SETTINGS': {
      await storage.importAll(data);
      const importedSettings = await storage.getSettings();
      await syncScopedNetworkRules(importedSettings, true);
      await updateBadge();
      return { success: true, settings: importedSettings };
    }

    case 'RESET_STATS':
      await stats.reset();
      await updateBadge();
      return { success: true };

    case 'GET_CUSTOM_RULES':
      return storage.getCustomRules();

    case 'SAVE_CUSTOM_RULES':
      await storage.saveCustomRules(data);
      await rules.reloadRules();
      return { success: true };

    case 'CHECK_RULE_UPDATES': {
      await rules.checkForUpdates();
      const refreshedSettings = await storage.getSettings();
      await syncScopedNetworkRules(refreshedSettings, true);
      return {
        success: true,
        lastUpdate: refreshedSettings.updates?.lastUpdate || null
      };
    }

    default:
      log.warn('Unknown message type:', type);
      return { success: false, error: 'Unknown message type' };
  }
}

async function toggleSiteBlocking(hostname, enabled) {
  const settings = await storage.getSettings();
  const normalizedHostname = normalizeHostname(hostname);

  if (!normalizedHostname) {
    return { success: false, error: 'Invalid hostname' };
  }

  const nextEnabledSites = settings.enabledSites.filter(
    (domain) => !listHasMatchingHostname(normalizedHostname, [domain])
  );

  if (enabled) {
    nextEnabledSites.push(normalizedHostname);
  }

  await storage.updateSettings({ enabledSites: nextEnabledSites });
  const updatedSettings = await storage.getSettings();
  await syncScopedNetworkRules(updatedSettings);
  await updateBadge();

  return {
    success: true,
    enabled,
    enabledSites: updatedSettings.enabledSites
  };
}

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

  return {
    success: true,
    reportId: `AE-${Date.now()}`
  };
}

async function updateBadge(tabId) {
  try {
    const settings = await storage.getSettings();
    const todayStats = await stats.getTodayStats();

    if (!settings.enabled) {
      await chrome.action.setBadgeText({ text: 'OFF', tabId });
      await chrome.action.setBadgeBackgroundColor({ color: '#6B7280', tabId });
      return;
    }

    if (settings.ui?.showBadge === false) {
      await chrome.action.setBadgeText({ text: '', tabId });
      return;
    }

    const count = todayStats.adsBlocked;
    const text = count > 999 ? '999+' : count.toString();
    await chrome.action.setBadgeText({ text, tabId });
    await chrome.action.setBadgeBackgroundColor({ color: '#10B981', tabId });
  } catch (error) {
    log.error('Badge update error:', error);
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  log.debug('Alarm triggered:', alarm.name);

  switch (alarm.name) {
    case 'updateRules':
      await rules.checkForUpdates();
      await syncScopedNetworkRules(await storage.getSettings(), true);
      break;
    case 'syncStats':
      await stats.sync();
      break;
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log.debug('Message received:', message.type, sender.tab?.id);

  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      log.error('Message handler error:', error);
      sendResponse({ success: false, error: error.message });
    });

  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url) {
    try {
      if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) {
        return;
      }

      const settings = await storage.getSettings();
      const siteStatus = getSiteStatus(tab.url, settings);

      if (siteStatus.enabled) {
        if (isYouTubeHost(siteStatus.hostname)) {
          chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ['src/content/youtube-mainworld.js'],
            world: 'MAIN',
            injectImmediately: true
          }).catch(() => {});

          chrome.scripting.insertCSS({
            target: { tabId, allFrames: true },
            files: ['src/content/youtube.css']
          }).catch(() => {});

          chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ['src/content/youtube.js'],
            injectImmediately: true
          }).catch(() => {});
        } else {
          chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ['src/content/general-mainworld.js'],
            world: 'MAIN',
            injectImmediately: true
          }).catch(() => {});

          chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ['src/content/anti-adblock.js'],
            world: 'MAIN',
            injectImmediately: true
          }).catch(() => {});

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
      }
    } catch (error) {
      log.debug('Script injection error:', error.message);
    }
  }

  if (changeInfo.status === 'complete' && tab.url) {
    await updateBadge(tabId);
  }
});

chrome.runtime.onInstalled.addListener(async (details) => {
  log.info('Extension installed/updated:', details.reason);

  if (details.reason === 'install') {
    await storage.initializeDefaults();

    chrome.tabs.create({
      url: chrome.runtime.getURL('src/options/options.html?welcome=true')
    });
  } else if (details.reason === 'update') {
    await rules.checkForUpdates();
  }

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

  await initialize();
});

chrome.runtime.onStartup.addListener(async () => {
  await initialize();
});

if (chrome.declarativeNetRequest?.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    log.debug('Rule matched:', info.rule.ruleId, info.request.url);
    stats.incrementBlocked('network', normalizeHostname(info.request.url));
  });
}

if (chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    try {
      if (info.menuItemId === 'adeclipse-toggle') {
        const hostname = normalizeHostname(tab?.url);
        const settings = await storage.getSettings();
        const currentlyEnabled = isSiteEnabled(hostname, settings);
        await toggleSiteBlocking(hostname, !currentlyEnabled);
        chrome.tabs.reload(tab.id);
      } else if (info.menuItemId === 'adeclipse-report') {
        chrome.tabs.sendMessage(tab.id, { type: 'SHOW_REPORT_DIALOG' });
      }
    } catch (error) {
      log.error('Context menu click error:', error);
    }
  });
}

initialize();
