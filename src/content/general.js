/**
 * AdEclipse - General Content Script
 * Handles ad blocking for all websites (except YouTube)
 */

(function() {
  'use strict';
  
  // Prevent multiple injections
  if (window.__ADECLIPSE_GENERAL_LOADED__) return;
  window.__ADECLIPSE_GENERAL_LOADED__ = true;
  
  // Configuration
  const CONFIG = {
    enabled: true,
    mode: 'balanced',
    debugMode: false,
    observerDebounce: 100,
    maxMutations: 50,
    blockTypes: {
      bannerAds: true,
      overlayAds: true,
      sponsoredContent: true,
      popups: true,
      cookieBanners: false,
      newsletterPopups: false
    }
  };
  
  // State
  const state = {
    hostname: window.location.hostname,
    selectors: null,
    observer: null,
    adsBlocked: 0,
    elementsRemoved: new WeakSet(),
    initialized: false
  };
  
  // Logging
  const log = {
    debug: (...args) => CONFIG.debugMode && console.log('[AdEclipse]', ...args),
    info: (...args) => console.info('[AdEclipse]', ...args),
    warn: (...args) => console.warn('[AdEclipse]', ...args)
  };
  
  /**
   * Initialize the content script
   */
  async function initialize() {
    if (state.initialized) return;
    state.initialized = true;
    
    log.debug('Initializing for:', state.hostname);
    
    // Load settings and selectors
    await loadSettings();
    
    if (!CONFIG.enabled) {
      log.debug('AdEclipse is disabled for this site');
      return;
    }
    
    await loadSelectors();
    
    // Inject styles immediately
    injectStyles();
    
    // Initial cleanup
    removeAds();
    
    // Set up mutation observer
    setupObserver();
    
    // Handle lazy-loaded content
    setupScrollListener();
    
    log.info('AdEclipse initialized');
  }
  
  /**
   * Load settings from background
   */
  async function loadSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SITE_ENABLED' });
      if (response) {
        CONFIG.enabled = response.enabled;
        CONFIG.mode = response.mode || 'balanced';
        if (response.blockTypes) {
          Object.assign(CONFIG.blockTypes, response.blockTypes);
        }
      }
    } catch (error) {
      log.warn('Could not load settings:', error.message);
    }
  }
  
  /**
   * Load selectors from background
   */
  async function loadSelectors() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_SELECTORS',
        data: { hostname: state.hostname }
      });
      state.selectors = response;
    } catch (error) {
      log.warn('Could not load selectors:', error.message);
      state.selectors = getDefaultSelectors();
    }
  }
  
  /**
   * Get default selectors if loading fails
   */
  function getDefaultSelectors() {
    return {
      generic: {
        common: [
          '[id*="google_ads"]',
          '[class*="google-ads"]',
          '[id*="ad-container"]',
          '[class*="ad-container"]',
          '[id*="advertisement"]',
          '[class*="advertisement"]',
          '.ad', '.ads', '.advert',
          '.adsbygoogle',
          '[data-ad]',
          '[data-ad-slot]',
          '[id^="div-gpt-ad"]',
          'ins.adsbygoogle',
          'amp-ad'
        ],
        banner: [
          '.banner-ad',
          '.header-ad',
          '.footer-ad',
          '[class*="leaderboard"]',
          '[class*="billboard"]'
        ],
        sidebar: [
          '.sidebar-ad',
          '#sidebar-ad',
          '.sidebar .ad'
        ],
        inline: [
          '.in-article-ad',
          '.mid-article-ad',
          '.inline-ad'
        ]
      }
    };
  }
  
  /**
   * Inject CSS to hide common ad elements
   */
  function injectStyles() {
    const style = document.createElement('style');
    style.id = 'adeclipse-styles';
    
    // Build CSS from selectors
    let css = '';
    
    // Generic selectors
    if (state.selectors?.generic) {
      for (const [category, selectors] of Object.entries(state.selectors.generic)) {
        if (Array.isArray(selectors)) {
          css += selectors.join(',\n') + ' {\n';
          css += '  display: none !important;\n';
          css += '  visibility: hidden !important;\n';
          css += '  height: 0 !important;\n';
          css += '  min-height: 0 !important;\n';
          css += '  max-height: 0 !important;\n';
          css += '  overflow: hidden !important;\n';
          css += '}\n\n';
        }
      }
    }
    
    // Site-specific selectors
    if (state.selectors?.site?.selectors) {
      for (const [category, selectors] of Object.entries(state.selectors.site.selectors)) {
        if (Array.isArray(selectors)) {
          css += selectors.join(',\n') + ' {\n';
          css += '  display: none !important;\n';
          css += '}\n\n';
        }
      }
    }
    
    // Cookie banners (if enabled)
    if (CONFIG.blockTypes.cookieBanners && state.selectors?.cookieBanners) {
      css += state.selectors.cookieBanners.join(',\n') + ' {\n';
      css += '  display: none !important;\n';
      css += '}\n\n';
    }
    
    // Removal animation
    css += `
      .adeclipse-removing {
        opacity: 0 !important;
        transform: scale(0.95) !important;
        transition: opacity 0.15s ease-out, transform 0.15s ease-out !important;
        pointer-events: none !important;
      }
      
      .adeclipse-collapsed {
        display: none !important;
        height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
      }
    `;
    
    const head = document.head || document.documentElement;
    head.insertBefore(style, head.firstChild);
  }
  
  /**
   * Set up mutation observer
   */
  function setupObserver() {
    if (state.observer) {
      state.observer.disconnect();
    }
    
    let debounceTimer = null;
    
    state.observer = new MutationObserver((mutations) => {
      // Quick check for ad-related changes
      let hasAdMutation = false;
      
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (isLikelyAd(node)) {
                hasAdMutation = true;
                break;
              }
            }
          }
        }
        if (hasAdMutation) break;
      }
      
      if (hasAdMutation) {
        // Immediate action for obvious ads
        removeAds();
      }
      
      // Debounced full check
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      
      debounceTimer = setTimeout(() => {
        removeAds();
      }, CONFIG.observerDebounce);
    });
    
    state.observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
  
  /**
   * Quick heuristic check if element is likely an ad
   */
  function isLikelyAd(element) {
    const className = element.className?.toString().toLowerCase() || '';
    const id = element.id?.toLowerCase() || '';
    const tagName = element.tagName?.toLowerCase() || '';
    
    // Quick string checks
    const adPatterns = ['ad', 'ads', 'advert', 'sponsor', 'promo', 'banner'];
    
    for (const pattern of adPatterns) {
      if (className.includes(pattern) || id.includes(pattern)) {
        return true;
      }
    }
    
    // Check for known ad elements
    if (tagName === 'ins' && element.classList.contains('adsbygoogle')) {
      return true;
    }
    
    if (tagName === 'amp-ad' || tagName === 'amp-auto-ads') {
      return true;
    }
    
    // Check data attributes
    if (element.dataset?.ad || element.dataset?.adSlot || element.dataset?.adUnit) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Remove ad elements from DOM
   */
  function removeAds() {
    if (!state.selectors) return;
    
    const allSelectors = [];
    
    // Collect all applicable selectors
    if (state.selectors.generic) {
      for (const selectors of Object.values(state.selectors.generic)) {
        if (Array.isArray(selectors)) {
          allSelectors.push(...selectors);
        }
      }
    }
    
    if (state.selectors.site?.selectors) {
      for (const selectors of Object.values(state.selectors.site.selectors)) {
        if (Array.isArray(selectors)) {
          allSelectors.push(...selectors);
        }
      }
    }
    
    if (state.selectors.custom) {
      for (const selectors of Object.values(state.selectors.custom)) {
        if (Array.isArray(selectors)) {
          allSelectors.push(...selectors);
        }
      }
    }
    
    // Cookie banners
    if (CONFIG.blockTypes.cookieBanners && state.selectors.cookieBanners) {
      allSelectors.push(...state.selectors.cookieBanners);
    }
    
    // Query and remove
    for (const selector of allSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          removeElement(el);
        }
      } catch (e) {
        // Invalid selector, skip
      }
    }
    
    // Also do heuristic scan
    if (CONFIG.mode === 'aggressive') {
      scanForAds();
    }
  }
  
  /**
   * Heuristic scan for ads
   */
  function scanForAds() {
    // Check iframes
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      const src = iframe.src?.toLowerCase() || '';
      if (src.includes('ad') || src.includes('doubleclick') || 
          src.includes('googlesyndication') || src.includes('amazon-adsystem')) {
        removeElement(iframe);
      }
    }
    
    // Check elements by size (typical ad sizes)
    const adSizes = [
      [728, 90],   // Leaderboard
      [300, 250],  // Medium rectangle
      [336, 280],  // Large rectangle
      [300, 600],  // Half page
      [970, 250],  // Billboard
      [320, 50],   // Mobile banner
      [320, 100],  // Large mobile banner
      [160, 600],  // Wide skyscraper
      [120, 600],  // Skyscraper
    ];
    
    const allDivs = document.querySelectorAll('div, aside, section');
    for (const div of allDivs) {
      const rect = div.getBoundingClientRect();
      
      // Check if matches common ad sizes
      for (const [w, h] of adSizes) {
        if (Math.abs(rect.width - w) < 10 && Math.abs(rect.height - h) < 10) {
          // Likely an ad, but verify with additional checks
          if (hasAdIndicators(div)) {
            removeElement(div);
            break;
          }
        }
      }
    }
  }
  
  /**
   * Check if element has ad indicators
   */
  function hasAdIndicators(element) {
    // Check for ad-related text
    const text = element.textContent?.toLowerCase() || '';
    const adWords = ['advertisement', 'sponsored', 'ad choices', 'adchoices'];
    
    for (const word of adWords) {
      if (text.includes(word)) {
        return true;
      }
    }
    
    // Check for tracking attributes
    const html = element.outerHTML?.toLowerCase() || '';
    const trackingPatterns = ['data-ad', 'google_ads', 'dfp', 'gpt-ad'];
    
    for (const pattern of trackingPatterns) {
      if (html.includes(pattern)) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Remove element with animation
   */
  function removeElement(element) {
    if (!element || state.elementsRemoved.has(element)) return;
    
    state.elementsRemoved.add(element);
    
    // Add removing class for animation
    element.classList.add('adeclipse-removing');
    
    // Remove after animation
    setTimeout(() => {
      element.classList.add('adeclipse-collapsed');
      
      // Optionally fully remove from DOM
      if (CONFIG.mode === 'aggressive') {
        element.remove();
      }
      
      state.adsBlocked++;
      notifyAdBlocked();
    }, 150);
  }
  
  /**
   * Handle lazy-loaded content on scroll
   */
  function setupScrollListener() {
    let scrollTimer = null;
    
    window.addEventListener('scroll', () => {
      if (scrollTimer) {
        clearTimeout(scrollTimer);
      }
      
      scrollTimer = setTimeout(() => {
        removeAds();
      }, 200);
    }, { passive: true });
  }
  
  /**
   * Notify background of blocked ad
   */
  function notifyAdBlocked() {
    try {
      chrome.runtime.sendMessage({
        type: 'INCREMENT_BLOCKED',
        data: { type: 'bannerAd', domain: state.hostname }
      });
    } catch (e) {
      // Extension context may be invalid
    }
  }
  
  /**
   * Clean up on unload
   */
  function cleanup() {
    if (state.observer) {
      state.observer.disconnect();
    }
  }
  
  window.addEventListener('pagehide', cleanup);
  
  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
})();
