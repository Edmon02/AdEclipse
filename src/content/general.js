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

    // Set up dedicated click-jack overlay monitor (polls & observes)
    setupClickjackMonitor();

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

    // Always scan for click-jacking overlays (these are dangerous on all modes)
    removeClickjackOverlays();
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
   * Detect and remove click-jacking overlay ads.
   *
   * Many shady sites inject transparent <div> layers with:
   *   - position: absolute/fixed
   *   - z-index: very high  (often 2147483647)
   *   - pointer-events: auto
   *   - no meaningful visible content (empty or only nested divs)
   *   - covering a large portion of the viewport
   *
   * These intercept every click and redirect the user to an ad URL.
   * We detect them heuristically and remove them, then keep watching
   * because many sites re-inject them after removal.
   */
  function removeClickjackOverlays() {
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    // Minimum coverage to be suspicious: 40% of viewport area
    const minArea = viewW * viewH * 0.4;

    // Check all absolutely/fixed positioned elements with very high z-index
    const candidates = document.querySelectorAll(
      'div, span, section, aside, a'
    );

    for (const el of candidates) {
      if (state.elementsRemoved.has(el)) continue;

      const style = getComputedStyle(el);
      const position = style.position;
      if (position !== 'absolute' && position !== 'fixed') continue;

      const zIndex = parseInt(style.zIndex, 10);
      if (isNaN(zIndex) || zIndex < 9999) continue;

      const pointerEvents = style.pointerEvents;
      // Elements with pointer-events:none at the top level are not dangerous
      // but their children might have pointer-events:auto – check those too
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;

      if (area < minArea) continue;

      // Check if the element is essentially empty/transparent (click-jack layer)
      const isClickjack = isClickjackOverlay(el, style);
      if (isClickjack) {
        log.debug('Removing click-jack overlay:', el.className || el.tagName, rect.width + 'x' + rect.height, 'z-index:' + zIndex);
        el.remove();
        state.adsBlocked++;
        notifyAdBlocked();
        continue;
      }

      // Also check children that are large pointer-events:auto overlays
      removeClickjackChildren(el);
    }
  }

  /**
   * Determine if an element is a click-jacking overlay.
   */
  function isClickjackOverlay(el, style) {
    // Must have pointer-events that can capture clicks (auto is default)
    if (style.pointerEvents === 'none') {
      // If parent has pointer-events:none, check if children have auto
      return hasClickjackChildren(el);
    }

    // Check if the element has no real visible content
    // (background is transparent/none, no text, no images)
    const bg = style.backgroundColor;
    const bgImage = style.backgroundImage;
    const hasVisibleBg = bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)';
    const hasVisibleBgImg = bgImage && bgImage !== 'none';
    const hasDirectText = getDirectTextContent(el).trim().length > 0;

    // If it has visible content, it might be a real element
    if (hasVisibleBg || hasVisibleBgImg || hasDirectText) {
      return false;
    }

    // Empty/transparent element covering a large area with high z-index = click-jack
    return true;
  }

  /**
   * Check if an element with pointer-events:none has children with pointer-events:auto
   * that act as click-jacking layers.
   */
  function hasClickjackChildren(parent) {
    const children = parent.children;
    for (const child of children) {
      const cs = getComputedStyle(child);
      if (cs.pointerEvents === 'auto') {
        const rect = child.getBoundingClientRect();
        const viewW = window.innerWidth;
        const viewH = window.innerHeight;
        if (rect.width * rect.height > viewW * viewH * 0.3) {
          const text = getDirectTextContent(child).trim();
          if (text.length === 0) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Remove click-jacking children of a container (e.g. parent has pointer-events:none
   * but children have pointer-events:auto covering the page).
   */
  function removeClickjackChildren(parent) {
    const children = parent.children;
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    let removedAny = false;

    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (state.elementsRemoved.has(child)) continue;

      const cs = getComputedStyle(child);
      if (cs.pointerEvents !== 'auto') continue;

      const pos = cs.position;
      if (pos !== 'absolute' && pos !== 'fixed') continue;

      const rect = child.getBoundingClientRect();
      if (rect.width * rect.height < viewW * viewH * 0.3) continue;

      const text = getDirectTextContent(child).trim();
      const bg = cs.backgroundColor;
      const hasBg = bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)';
      const bgImg = cs.backgroundImage;
      const hasBgImg = bgImg && bgImg !== 'none';

      // Empty overlay child covering a large portion = click-jacking
      if (text.length === 0 && !hasBg && !hasBgImg) {
        log.debug('Removing click-jack child:', child.className || child.tagName);
        child.remove();
        state.adsBlocked++;
        notifyAdBlocked();
        removedAny = true;
      }
    }

    // If we removed all meaningful children, remove the parent wrapper too
    if (removedAny && parent.children.length === 0) {
      parent.remove();
    }
  }

  /**
   * Get only direct text content of an element (not its children's text).
   */
  function getDirectTextContent(el) {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      }
    }
    return text;
  }

  const STRUCTURAL_TAGS = new Set([
    'HTML', 'BODY', 'MAIN', 'ARTICLE', 'HEADER', 'FOOTER', 'NAV'
  ]);

  /**
   * Remove element with animation and collapse empty parent containers
   */
  function removeElement(element) {
    if (!element || state.elementsRemoved.has(element)) return;
    
    state.elementsRemoved.add(element);
    
    element.classList.add('adeclipse-removing');
    
    setTimeout(() => {
      element.classList.add('adeclipse-collapsed');
      element.style.setProperty('min-height', '0', 'important');
      element.style.setProperty('height', '0', 'important');
      element.style.setProperty('margin', '0', 'important');
      element.style.setProperty('padding', '0', 'important');
      
      if (CONFIG.mode === 'aggressive') {
        element.remove();
      }
      
      collapseEmptyAncestors(element);
      
      state.adsBlocked++;
      notifyAdBlocked();
    }, 150);
  }

  function collapseEmptyAncestors(element) {
    let parent = element.parentElement;
    let depth = 0;

    while (parent && depth < 6) {
      if (STRUCTURAL_TAGS.has(parent.tagName)) break;
      if (parent.id && /^(content|main|app|root|wrapper|page)$/i.test(parent.id)) break;

      if (isContainerEffectivelyEmpty(parent)) {
        parent.classList.add('adeclipse-empty-container');
        parent.style.setProperty('min-height', '0', 'important');
        parent.style.setProperty('height', '0', 'important');
        parent.style.setProperty('margin', '0', 'important');
        parent.style.setProperty('padding', '0', 'important');
        state.elementsRemoved.add(parent);
        parent = parent.parentElement;
        depth++;
      } else {
        parent.style.setProperty('min-height', '0', 'important');
        break;
      }
    }
  }

  function isContainerEffectivelyEmpty(el) {
    for (const child of el.children) {
      if (child.classList.contains('adeclipse-collapsed') ||
          child.classList.contains('adeclipse-empty-container') ||
          child.classList.contains('adeclipse-removing')) {
        continue;
      }
      try {
        const style = getComputedStyle(child);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const rect = child.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return false;
      } catch (e) { return false; }
    }

    let directText = '';
    for (const node of el.childNodes) {
      if (node.nodeType === 3) directText += node.textContent;
    }
    if (directText.trim().length > 0) return false;

    return true;
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
   * Dedicated monitor for click-jacking overlays.
   * These are often re-injected by ad scripts after removal,
   * so we use a fast-polling approach in addition to mutation observation.
   */
  function setupClickjackMonitor() {
    // Poll every 500ms – overlay re-injection is common
    state.clickjackInterval = setInterval(() => {
      removeClickjackOverlays();
    }, 500);

    // Also observe changes to style attributes (overlays can be shown via style changes)
    state.clickjackObserver = new MutationObserver((mutations) => {
      let needsScan = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const style = node.style;
              // Fast check: if the new node has high z-index, scan immediately
              if (style && (parseInt(style.zIndex, 10) > 9999 || style.position === 'fixed' || style.position === 'absolute')) {
                needsScan = true;
                break;
              }
            }
          }
        } else if (mutation.type === 'attributes') {
          if (mutation.attributeName === 'style' || mutation.attributeName === 'class') {
            needsScan = true;
          }
        }
        if (needsScan) break;
      }
      if (needsScan) {
        removeClickjackOverlays();
      }
    });

    state.clickjackObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    });
  }

  /**
   * Clean up on unload
   */
  function cleanup() {
    if (state.observer) {
      state.observer.disconnect();
    }
    if (state.clickjackObserver) {
      state.clickjackObserver.disconnect();
    }
    if (state.clickjackInterval) {
      clearInterval(state.clickjackInterval);
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
