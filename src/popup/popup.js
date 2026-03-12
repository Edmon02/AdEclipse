/**
 * AdEclipse - Popup Script
 * Handles popup UI interactions and settings
 */

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadStats();
  await loadCurrentSite();
  setupEventListeners();
});

let settings = {};
let currentTab = null;

function normalizeHostname(input) {
  if (!input) return '';

  try {
    return new URL(input).hostname.replace(/^www\./, '').toLowerCase();
  } catch (_) {
    return String(input).trim().toLowerCase().replace(/^www\./, '').split('/')[0].split(':')[0];
  }
}

function hostnameMatches(hostname, domain) {
  const normalizedHostname = normalizeHostname(hostname);
  const normalizedDomain = normalizeHostname(domain);

  return normalizedHostname === normalizedDomain ||
    normalizedHostname.endsWith(`.${normalizedDomain}`);
}

function isSiteAdded(hostname) {
  return (settings.enabledSites || []).some((domain) => hostnameMatches(hostname, domain));
}

async function loadSettings() {
  try {
    settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    updateUI();
  } catch (error) {
    console.error('Failed to load settings:', error);
    showError('Could not load settings');
  }
}

async function loadStats() {
  try {
    const stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
    updateStatsUI(stats);
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

async function loadCurrentSite() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
    updateCurrentSiteUI();
  } catch (error) {
    console.error('Failed to get current tab:', error);
    document.getElementById('siteName').textContent = 'Unknown';
  }
}

function updateCurrentSiteUI() {
  const siteName = document.getElementById('siteName');
  const siteToggle = document.getElementById('siteToggle');

  if (!currentTab?.url) {
    siteName.textContent = 'Unsupported page';
    siteToggle.classList.add('disabled');
    siteToggle.title = 'This page cannot be protected';
    return;
  }

  const hostname = normalizeHostname(currentTab.url);
  const added = isSiteAdded(hostname);
  const active = added && settings.enabled;

  siteName.textContent = hostname;
  siteToggle.classList.toggle('disabled', !added);
  siteToggle.title = added
    ? (active ? 'Protection is active on this site' : 'This site is added, but protection is paused globally')
    : 'Add this site to enable protection';
}

function updateUI() {
  const mainToggle = document.getElementById('mainToggle');
  const statusText = document.getElementById('statusText');

  mainToggle.checked = settings.enabled;
  statusText.textContent = settings.enabled ? 'Active' : 'Paused';
  statusText.classList.toggle('inactive', !settings.enabled);

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === settings.mode);
  });

  if (settings.blockTypes) {
    document.getElementById('blockVideo').checked = settings.blockTypes.videoAds ?? true;
    document.getElementById('blockBanner').checked = settings.blockTypes.bannerAds ?? true;
    document.getElementById('blockSponsored').checked = settings.blockTypes.sponsoredContent ?? true;
    document.getElementById('blockPopups').checked = settings.blockTypes.popups ?? true;
    document.getElementById('blockTrackers').checked = settings.blockTypes.trackers ?? true;
    document.getElementById('blockCookies').checked = settings.blockTypes.cookieBanners ?? false;
  }

  if (settings.ui?.darkMode === 'dark') {
    document.body.classList.add('dark');
  } else if (settings.ui?.darkMode === 'light') {
    document.body.classList.remove('dark');
  }

  updateCurrentSiteUI();
}

function updateStatsUI(stats) {
  if (!stats) return;

  const today = stats.today || { adsBlocked: 0, timeSaved: 0, dataSaved: 0, adsSkipped: 0 };

  document.getElementById('adsBlocked').textContent = formatNumber(today.adsBlocked);
  document.getElementById('timeSaved').textContent = formatTime(today.timeSaved);
  document.getElementById('dataSaved').textContent = formatData(today.dataSaved);
  document.getElementById('adsSkipped').textContent = formatNumber(today.adsSkipped);
}

function setupEventListeners() {
  document.getElementById('mainToggle').addEventListener('change', async (e) => {
    await updateSettings({ enabled: e.target.checked });

    if (currentTab) {
      chrome.tabs.reload(currentTab.id);
    }
  });

  document.getElementById('siteToggle').addEventListener('click', async () => {
    if (!currentTab?.url) return;

    const hostname = normalizeHostname(currentTab.url);
    const nextEnabled = !isSiteAdded(hostname);

    await chrome.runtime.sendMessage({
      type: 'TOGGLE_SITE',
      data: { hostname, enabled: nextEnabled }
    });

    await loadSettings();
    await loadCurrentSite();
    chrome.tabs.reload(currentTab.id);
  });

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.mode-btn').forEach((item) => item.classList.remove('active'));
      btn.classList.add('active');
      await updateSettings({ mode: btn.dataset.mode });
    });
  });

  const blockTypeMap = {
    blockVideo: 'videoAds',
    blockBanner: 'bannerAds',
    blockSponsored: 'sponsoredContent',
    blockPopups: 'popups',
    blockTrackers: 'trackers',
    blockCookies: 'cookieBanners'
  };

  Object.entries(blockTypeMap).forEach(([elementId, settingKey]) => {
    document.getElementById(elementId).addEventListener('change', async (e) => {
      const blockTypes = { ...settings.blockTypes, [settingKey]: e.target.checked };
      await updateSettings({ blockTypes });
    });
  });

  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('viewStatsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('reportBtn').addEventListener('click', () => {
    document.getElementById('reportModal').classList.add('active');
  });

  document.getElementById('closeReportModal').addEventListener('click', () => {
    document.getElementById('reportModal').classList.remove('active');
  });

  document.getElementById('submitReport').addEventListener('click', async () => {
    const description = document.getElementById('reportDescription').value;

    if (!description.trim()) {
      return;
    }

    try {
      await chrome.runtime.sendMessage({
        type: 'REPORT_BUG',
        data: {
          url: currentTab?.url,
          description,
          userAgent: navigator.userAgent
        }
      });

      document.getElementById('reportModal').classList.remove('active');
      document.getElementById('reportDescription').value = '';
      showNotification('Report submitted, thank you!');
    } catch (error) {
      console.error('Failed to submit report:', error);
      showError('Could not submit report');
    }
  });

  document.getElementById('reportModal').addEventListener('click', (e) => {
    if (e.target.id === 'reportModal') {
      e.target.classList.remove('active');
    }
  });
}

async function updateSettings(updates) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      data: updates
    });

    settings = response?.settings || { ...settings, ...updates };
    updateUI();
  } catch (error) {
    console.error('Failed to update settings:', error);
    showError('Could not save settings');
  }
}

/**
 * Format number with commas
 */
function formatNumber(num) {
  if (num === undefined || num === null) return '0';
  return num.toLocaleString();
}

/**
 * Format time duration
 */
function formatTime(seconds) {
  if (!seconds || seconds === 0) return '0s';
  
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
}

/**
 * Format data size
 */
function formatData(kb) {
  if (!kb || kb === 0) return '0 KB';
  
  if (kb < 1024) {
    return `${Math.round(kb)} KB`;
  } else if (kb < 1024 * 1024) {
    return `${(kb / 1024).toFixed(1)} MB`;
  } else {
    return `${(kb / (1024 * 1024)).toFixed(2)} GB`;
  }
}

/**
 * Show notification
 */
function showNotification(message) {
  // Create notification element
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M9 12l2 2 4-4"/>
      <circle cx="12" cy="12" r="10"/>
    </svg>
    <span>${message}</span>
  `;
  notification.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--color-primary);
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 9999;
    animation: slideUp 0.3s ease;
  `;
  
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideUp {
      from { opacity: 0; transform: translateX(-50%) translateY(10px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
  `;
  
  document.head.appendChild(style);
  document.body.appendChild(notification);
  
  // Remove after 3 seconds
  setTimeout(() => {
    notification.style.animation = 'slideUp 0.3s ease reverse';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

/**
 * Show error
 */
function showError(message) {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--color-danger);
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 9999;
  `;
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  setTimeout(() => notification.remove(), 3000);
}

// Refresh stats periodically
setInterval(loadStats, 5000);
