/**
 * AdEclipse - Popup Script
 * Handles popup UI interactions and settings
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize
  await loadSettings();
  await loadStats();
  await loadCurrentSite();
  setupEventListeners();
});

// State
let settings = {};
let currentTab = null;

/**
 * Load settings from background
 */
async function loadSettings() {
  try {
    settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    updateUI();
  } catch (error) {
    console.error('Failed to load settings:', error);
    showError('Could not load settings');
  }
}

/**
 * Load stats from background
 */
async function loadStats() {
  try {
    const stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
    updateStatsUI(stats);
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

/**
 * Load current active tab info
 */
async function loadCurrentSite() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
    
    if (tab.url) {
      const url = new URL(tab.url);
      const hostname = url.hostname;
      
      document.getElementById('siteName').textContent = hostname;
      
      // Check if site is whitelisted
      const isWhitelisted = settings.whitelist?.includes(hostname);
      const siteToggle = document.getElementById('siteToggle');
      
      if (isWhitelisted) {
        siteToggle.classList.add('disabled');
        siteToggle.title = 'Ads allowed on this site';
      } else {
        siteToggle.classList.remove('disabled');
        siteToggle.title = 'Ads blocked on this site';
      }
    }
  } catch (error) {
    console.error('Failed to get current tab:', error);
    document.getElementById('siteName').textContent = 'Unknown';
  }
}

/**
 * Update UI based on settings
 */
function updateUI() {
  // Main toggle
  const mainToggle = document.getElementById('mainToggle');
  const statusText = document.getElementById('statusText');
  
  mainToggle.checked = settings.enabled;
  statusText.textContent = settings.enabled ? 'Active' : 'Paused';
  statusText.classList.toggle('inactive', !settings.enabled);
  
  // Mode buttons
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === settings.mode);
  });
  
  // Block types
  if (settings.blockTypes) {
    document.getElementById('blockVideo').checked = settings.blockTypes.videoAds ?? true;
    document.getElementById('blockBanner').checked = settings.blockTypes.bannerAds ?? true;
    document.getElementById('blockSponsored').checked = settings.blockTypes.sponsoredContent ?? true;
    document.getElementById('blockPopups').checked = settings.blockTypes.popups ?? true;
    document.getElementById('blockTrackers').checked = settings.blockTypes.trackers ?? true;
    document.getElementById('blockCookies').checked = settings.blockTypes.cookieBanners ?? false;
  }
  
  // Dark mode
  if (settings.ui?.darkMode === 'dark') {
    document.body.classList.add('dark');
  } else if (settings.ui?.darkMode === 'light') {
    document.body.classList.remove('dark');
  }
}

/**
 * Update stats UI
 */
function updateStatsUI(stats) {
  if (!stats) return;
  
  const today = stats.today || { adsBlocked: 0, timeSaved: 0, dataSaved: 0, adsSkipped: 0 };
  
  document.getElementById('adsBlocked').textContent = formatNumber(today.adsBlocked);
  document.getElementById('timeSaved').textContent = formatTime(today.timeSaved);
  document.getElementById('dataSaved').textContent = formatData(today.dataSaved);
  document.getElementById('adsSkipped').textContent = formatNumber(today.adsSkipped);
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Main toggle
  document.getElementById('mainToggle').addEventListener('change', async (e) => {
    await updateSettings({ enabled: e.target.checked });
    
    const statusText = document.getElementById('statusText');
    statusText.textContent = e.target.checked ? 'Active' : 'Paused';
    statusText.classList.toggle('inactive', !e.target.checked);
    
    // Reload current tab
    if (currentTab) {
      chrome.tabs.reload(currentTab.id);
    }
  });
  
  // Site toggle
  document.getElementById('siteToggle').addEventListener('click', async () => {
    if (!currentTab?.url) return;
    
    const hostname = new URL(currentTab.url).hostname;
    const isWhitelisted = settings.whitelist?.includes(hostname);
    
    await chrome.runtime.sendMessage({
      type: 'TOGGLE_SITE',
      data: { hostname, enabled: isWhitelisted }
    });
    
    // Reload settings and tab
    await loadSettings();
    await loadCurrentSite();
    chrome.tabs.reload(currentTab.id);
  });
  
  // Mode buttons
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      await updateSettings({ mode: btn.dataset.mode });
    });
  });
  
  // Block type toggles
  const blockTypeMap = {
    'blockVideo': 'videoAds',
    'blockBanner': 'bannerAds',
    'blockSponsored': 'sponsoredContent',
    'blockPopups': 'popups',
    'blockTrackers': 'trackers',
    'blockCookies': 'cookieBanners'
  };
  
  Object.entries(blockTypeMap).forEach(([elementId, settingKey]) => {
    document.getElementById(elementId).addEventListener('change', async (e) => {
      const blockTypes = { ...settings.blockTypes, [settingKey]: e.target.checked };
      await updateSettings({ blockTypes });
    });
  });
  
  // Settings button
  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  
  // View stats button
  document.getElementById('viewStatsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  
  // Report button
  document.getElementById('reportBtn').addEventListener('click', () => {
    document.getElementById('reportModal').classList.add('active');
  });
  
  // Close report modal
  document.getElementById('closeReportModal').addEventListener('click', () => {
    document.getElementById('reportModal').classList.remove('active');
  });
  
  // Submit report
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
  
  // Close modal on outside click
  document.getElementById('reportModal').addEventListener('click', (e) => {
    if (e.target.id === 'reportModal') {
      e.target.classList.remove('active');
    }
  });
}

/**
 * Update settings
 */
async function updateSettings(updates) {
  try {
    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      data: updates
    });
    
    // Merge updates locally
    settings = { ...settings, ...updates };
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
