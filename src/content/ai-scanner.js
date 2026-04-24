/**
 * AdEclipse AI Scanner - Content Script
 * Extracts page element metadata, sends to background for LLM analysis,
 * and smoothly removes detected ads.
 */

(function () {
  'use strict';

  if (window.__adeclipse_ai_scanner_loaded) return;
  window.__adeclipse_ai_scanner_loaded = true;

  const MIN_ELEMENT_SIZE = 50;
  const SCAN_DEBOUNCE_MS = 500;
  const MAX_TEXT_LENGTH = 200;
  const MAX_SCAN_ELEMENTS = 60;

  const AD_HINT_SELECTORS = [
    'iframe[src*="ad"]', 'iframe[src*="doubleclick"]', 'iframe[src*="googlesyndication"]',
    '[class*="ad-"]', '[class*="ad_"]', '[class*="ads-"]', '[class*="ads_"]',
    '[class*="advert"]', '[class*="sponsor"]', '[class*="promo"]',
    '[id*="ad-"]', '[id*="ad_"]', '[id*="ads-"]', '[id*="ads_"]',
    '[data-ad]', '[data-ad-slot]', '[data-ad-unit]', '[data-adunit]',
    '[class*="taboola"]', '[class*="outbrain"]', '[id*="taboola"]', '[id*="outbrain"]',
    '[class*="native-ad"]', '[class*="sponsored"]', '[class*="promoted"]'
  ];

  const SKIP_TAGS = new Set([
    'HTML', 'HEAD', 'BODY', 'SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'BR', 'HR'
  ]);

  const CONTENT_TAGS = new Set([
    'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI',
    'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH',
    'PRE', 'CODE', 'BLOCKQUOTE', 'FORM', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON',
    'LABEL', 'FIELDSET', 'LEGEND'
  ]);

  let config = {
    enabled: false,
    scanMode: 'smart',
    smoothRemoval: true,
    debugMode: false,
    confidenceThreshold: 0.7
  };

  let scanTimer = null;
  let observer = null;
  let processedElements = new WeakSet();
  let pendingScan = false;
  let elementCounter = 0;

  async function initialize() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'AI_GET_CONFIG' });
      if (!response || !response.enabled) return;

      config = { ...config, ...response };
      setupObserver();

      if (config.scanOnLoad !== false) {
        scheduleScan();
      }
    } catch (error) {
      // Extension context may be invalid - silently exit
    }
  }

  function setupObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver((mutations) => {
      let hasRelevantChanges = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1 && !SKIP_TAGS.has(node.tagName)) {
              hasRelevantChanges = true;
              break;
            }
          }
        }
        if (hasRelevantChanges) break;
      }

      if (hasRelevantChanges && config.continuousScan !== false) {
        scheduleScan();
      }
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function scheduleScan() {
    if (pendingScan) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => runScan(), SCAN_DEBOUNCE_MS);
  }

  async function runScan() {
    if (pendingScan) return;
    pendingScan = true;

    try {
      const candidates = collectCandidates();
      if (candidates.length === 0) {
        pendingScan = false;
        return;
      }

      const descriptors = candidates.map(({ element }) => extractMetadata(element));

      const response = await chrome.runtime.sendMessage({
        type: 'AI_SCAN_ELEMENTS',
        data: {
          elements: descriptors,
          domain: window.location.hostname
        }
      });

      if (response && response.results) {
        applyVerdicts(response.results, candidates);
      }
    } catch (error) {
      if (!error.message?.includes('Extension context invalidated')) {
        console.error('[AdEclipse AI Scanner] Scan error:', error);
      }
    } finally {
      pendingScan = false;
    }
  }

  function collectCandidates() {
    const candidates = [];
    const allElements = [];

    if (config.scanMode === 'smart') {
      const hintSelector = AD_HINT_SELECTORS.join(', ');
      try {
        const hinted = document.querySelectorAll(hintSelector);
        for (const el of hinted) {
          if (isValidCandidate(el)) {
            allElements.push({ element: el, score: 2 });
          }
        }
      } catch (e) { /* invalid selector */ }

      const topLevel = document.querySelectorAll('div, section, aside, article, ins, iframe, figure');
      for (const el of topLevel) {
        if (isValidCandidate(el) && !allElements.some(c => c.element === el)) {
          const score = quickSuspicionScore(el);
          if (score > 0) {
            allElements.push({ element: el, score });
          }
        }
      }
    } else {
      const topLevel = document.querySelectorAll('div, section, aside, article, ins, iframe, figure, span, a');
      for (const el of topLevel) {
        if (isValidCandidate(el)) {
          allElements.push({ element: el, score: 1 });
        }
      }
    }

    allElements.sort((a, b) => b.score - a.score);

    const seen = new WeakSet();
    for (const item of allElements) {
      if (candidates.length >= MAX_SCAN_ELEMENTS) break;

      if (seen.has(item.element)) continue;
      seen.add(item.element);

      let dominated = false;
      for (const existing of candidates) {
        if (existing.element.contains(item.element) || item.element.contains(existing.element)) {
          dominated = true;
          break;
        }
      }
      if (!dominated) {
        candidates.push(item);
      }
    }

    return candidates;
  }

  function isValidCandidate(el) {
    if (processedElements.has(el)) return false;
    if (SKIP_TAGS.has(el.tagName)) return false;
    if (el.closest('.adeclipse-ai-hidden, .adeclipse-ai-fade-out')) return false;

    const rect = el.getBoundingClientRect();
    if (rect.width < MIN_ELEMENT_SIZE || rect.height < MIN_ELEMENT_SIZE) return false;
    if (rect.bottom < 0 || rect.top > window.innerHeight * 3) return false;

    return true;
  }

  function quickSuspicionScore(el) {
    let score = 0;
    const attrs = `${el.id || ''} ${el.className || ''}`.toLowerCase();

    if (/\bad[s]?\b|advert|banner|sponsor|promo/i.test(attrs)) score += 2;
    if (/taboola|outbrain|mgid|revcontent|zergnet/i.test(attrs)) score += 3;
    if (/google[_-]?ad|dfp|doubleclick|adsense/i.test(attrs)) score += 3;
    if (el.querySelector('iframe')) score += 1;

    const rect = el.getBoundingClientRect();
    const COMMON_AD_SIZES = [
      [728, 90], [300, 250], [160, 600], [320, 50],
      [300, 600], [970, 90], [970, 250], [336, 280]
    ];
    for (const [w, h] of COMMON_AD_SIZES) {
      if (Math.abs(rect.width - w) < 15 && Math.abs(rect.height - h) < 15) {
        score += 2;
        break;
      }
    }

    const text = (el.textContent || '').toLowerCase();
    if (/\bsponsored\b|\badvertisement\b|\bpromoted\b|\bad\b/.test(text.slice(0, 100))) score += 1;

    const links = el.querySelectorAll('a');
    let externalCount = 0;
    for (const link of links) {
      try {
        if (link.href && !link.href.includes(window.location.hostname)) externalCount++;
      } catch (e) { /* ignore */ }
    }
    if (links.length > 3 && externalCount === links.length) score += 1;

    const dataAttrs = Array.from(el.attributes).filter(a => a.name.startsWith('data-'));
    if (dataAttrs.some(a => /ad|slot|unit|campaign|sponsor/i.test(a.name + a.value))) score += 2;

    return score;
  }

  function extractMetadata(element) {
    const rect = element.getBoundingClientRect();
    const elId = `el_${elementCounter++}`;

    element.__adeclipse_scan_id = elId;

    const classes = element.className
      ? (typeof element.className === 'string' ? element.className.split(/\s+/).filter(Boolean) : [])
      : [];

    const text = (element.textContent || '').trim().slice(0, MAX_TEXT_LENGTH);
    const links = element.querySelectorAll('a');
    let externalLinkCount = 0;
    for (const link of links) {
      try {
        if (link.href && !link.href.includes(window.location.hostname)) externalLinkCount++;
      } catch (e) { /* ignore */ }
    }

    const childTags = [];
    for (let i = 0; i < Math.min(element.children.length, 10); i++) {
      childTags.push(element.children[i].tagName.toLowerCase());
    }

    const dataAttributes = Array.from(element.attributes)
      .filter(a => a.name.startsWith('data-'))
      .map(a => `${a.name}=${a.value}`.slice(0, 60));

    let position = 'middle';
    if (rect.top < 200) position = 'top';
    else if (rect.top > window.innerHeight - 200) position = 'bottom';
    if (rect.left > window.innerWidth * 0.7) position += '-right';
    else if (rect.right < window.innerWidth * 0.3) position += '-left';

    return {
      id: elId,
      tag: element.tagName.toLowerCase(),
      classes,
      elId: element.id || undefined,
      text: text || undefined,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      position,
      childTags,
      hasIframe: element.querySelector('iframe') !== null,
      hasVideo: element.querySelector('video') !== null,
      hasImage: element.querySelector('img') !== null,
      linkCount: links.length,
      externalLinkCount,
      dataAttributes: dataAttributes.length ? dataAttributes : undefined,
      ariaLabel: element.getAttribute('aria-label') || undefined,
      role: element.getAttribute('role') || undefined,
      src: element.tagName === 'IFRAME' ? (element.src || '').slice(0, 100) : undefined
    };
  }

  function applyVerdicts(verdicts, candidates) {
    for (const verdict of verdicts) {
      if (!verdict.isAd) continue;

      const candidate = candidates.find(c => c.element.__adeclipse_scan_id === verdict.elementId);
      if (!candidate) continue;

      const element = candidate.element;
      processedElements.add(element);

      if (config.debugMode) {
        element.classList.add('adeclipse-ai-detected');
        element.title = `AdEclipse AI: ${verdict.adType} (${Math.round(verdict.confidence * 100)}%) - ${verdict.reason}`;
        setTimeout(() => removeElement(element), 2000);
      } else {
        removeElement(element);
      }

      try {
        chrome.runtime.sendMessage({
          type: 'INCREMENT_BLOCKED',
          data: { type: verdict.adType || 'ai-detected', domain: window.location.hostname }
        });
      } catch (e) { /* ignore */ }
    }
  }

  function removeElement(element) {
    if (!element || !element.parentNode) return;

    if (!config.smoothRemoval) {
      element.classList.add('adeclipse-ai-hidden');
      cleanupAfterRemoval(element);
      collapseEmptyAncestors(element);
      return;
    }

    const rect = element.getBoundingClientRect();
    element.style.setProperty('max-height', `${rect.height}px`, 'important');
    element.style.setProperty('overflow', 'hidden', 'important');

    requestAnimationFrame(() => {
      element.classList.add('adeclipse-ai-fade-out');

      setTimeout(() => {
        element.classList.add('adeclipse-ai-collapsing');

        setTimeout(() => {
          element.classList.add('adeclipse-ai-hidden');
          element.classList.remove('adeclipse-ai-fade-out', 'adeclipse-ai-collapsing');
          element.style.removeProperty('max-height');
          element.style.removeProperty('overflow');
          cleanupAfterRemoval(element);
          collapseEmptyAncestors(element);
        }, 280);
      }, 320);
    });
  }

  function cleanupAfterRemoval(element) {
    try {
      const iframes = element.querySelectorAll('iframe');
      for (const iframe of iframes) {
        iframe.src = 'about:blank';
      }
      const videos = element.querySelectorAll('video');
      for (const video of videos) {
        video.pause();
        video.src = '';
      }
    } catch (e) { /* ignore */ }
  }

  const STRUCTURAL_TAGS = new Set([
    'HTML', 'BODY', 'MAIN', 'ARTICLE', 'HEADER', 'FOOTER', 'NAV'
  ]);

  function collapseEmptyAncestors(element) {
    let parent = element.parentElement;
    const MAX_DEPTH = 6;
    let depth = 0;

    while (parent && depth < MAX_DEPTH) {
      if (STRUCTURAL_TAGS.has(parent.tagName)) break;
      if (parent.id && /^(content|main|app|root|wrapper|page)$/i.test(parent.id)) break;

      if (isEffectivelyEmpty(parent)) {
        parent.classList.add('adeclipse-ai-empty-container');
        parent.style.setProperty('min-height', '0', 'important');
        parent.style.setProperty('height', '0', 'important');
        parent.style.setProperty('margin', '0', 'important');
        parent.style.setProperty('padding', '0', 'important');
        parent = parent.parentElement;
        depth++;
      } else {
        parent.style.setProperty('min-height', '0', 'important');
        break;
      }
    }
  }

  function isEffectivelyEmpty(el) {
    for (const child of el.children) {
      if (child.classList.contains('adeclipse-ai-hidden') ||
          child.classList.contains('adeclipse-ai-empty-container')) {
        continue;
      }
      const style = getComputedStyle(child);
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      const rect = child.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return false;
    }

    let directText = '';
    for (const node of el.childNodes) {
      if (node.nodeType === 3) directText += node.textContent;
    }
    if (directText.trim().length > 0) return false;

    return true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
})();
