/**
 * AdEclipse - Anti-Adblock Script
 * Handles anti-adblock detection bypassing
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__ADECLIPSE_ANTI_LOADED__) return;
  window.__ADECLIPSE_ANTI_LOADED__ = true;

  /**
   * Spoof ad-related globals that sites check for
   */
  function spoofAdGlobals() {
    // Create fake ad elements that anti-adblock scripts look for
    const fakeAd = document.createElement('div');
    fakeAd.id = 'ad-test';
    fakeAd.className = 'ad ads adsbox ad-placement doubleclick';
    fakeAd.innerHTML = '&nbsp;';
    fakeAd.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;';

    // Insert into DOM (hidden)
    if (document.body) {
      document.body.appendChild(fakeAd);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        document.body.appendChild(fakeAd);
      });
    }

    // Spoof common detection variables
    try {
      Object.defineProperty(window, 'adsbygoogle', {
        value: { loaded: true, push: () => { } },
        writable: false,
        configurable: false
      });
    } catch (e) { }

    try {
      Object.defineProperty(window, 'google_ad_client', {
        value: 'ca-pub-0000000000000000',
        writable: true
      });
    } catch (e) { }

    // Spoof DoubleClick
    try {
      window.googletag = window.googletag || {};
      window.googletag.cmd = window.googletag.cmd || [];
      window.googletag.apiReady = true;
      window.googletag.pubadsReady = true;
      window.googletag.defineSlot = () => window.googletag;
      window.googletag.addService = () => window.googletag;
      window.googletag.setTargeting = () => window.googletag;
      window.googletag.pubads = () => ({
        set: () => { },
        get: () => null,
        setTargeting: () => { },
        clearTargeting: () => { },
        enableSingleRequest: () => { },
        collapseEmptyDivs: () => { },
        enableLazyLoad: () => { },
        refresh: () => { },
        addEventListener: () => { },
        removeEventListener: () => { },
        disableInitialLoad: () => { },
        updateCorrelator: () => { },
        getSlots: () => [],
        getTargeting: () => [],
        getTargetingKeys: () => [],
        clear: () => { }
      });
      window.googletag.enableServices = () => { };
      window.googletag.display = () => { };
      window.googletag.companionAds = () => ({
        setRefreshUnfilledSlots: () => { }
      });
    } catch (e) { }
  }

  /**
   * Override methods that detect ad blocking
   */
  function overrideDetectionMethods() {
    // Override fetch to spoof ad requests
    const originalFetch = window.fetch;
    window.fetch = function (url, options) {
      const urlString = typeof url === 'string' ? url : url.url;

      // Check if this is an ad-detection request
      if (isAdDetectionRequest(urlString)) {
        return Promise.resolve(new Response('', { status: 200 }));
      }

      return originalFetch.apply(this, arguments);
    };

    // Override XMLHttpRequest
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...args) {
      this._adeclipse_url = url;
      return originalXHROpen.apply(this, [method, url, ...args]);
    };

    XMLHttpRequest.prototype.send = function (body) {
      if (isAdDetectionRequest(this._adeclipse_url)) {
        // Fake successful response
        Object.defineProperty(this, 'status', { value: 200 });
        Object.defineProperty(this, 'statusText', { value: 'OK' });
        Object.defineProperty(this, 'response', { value: '' });
        Object.defineProperty(this, 'responseText', { value: '' });

        setTimeout(() => {
          if (this.onload) this.onload();
          if (this.onreadystatechange) {
            Object.defineProperty(this, 'readyState', { value: 4 });
            this.onreadystatechange();
          }
        }, 10);
        return;
      }

      return originalXHRSend.apply(this, arguments);
    };

    // Override element dimension checks
    const originalGetComputedStyle = window.getComputedStyle;
    window.getComputedStyle = function (element, pseudoElt) {
      const result = originalGetComputedStyle.apply(this, arguments);

      // If checking an ad test element, return visible dimensions
      if (element && isAdTestElement(element)) {
        return new Proxy(result, {
          get(target, prop) {
            if (prop === 'display') return 'block';
            if (prop === 'visibility') return 'visible';
            if (prop === 'height') return '250px';
            if (prop === 'width') return '300px';
            return target[prop];
          }
        });
      }

      return result;
    };

    // Override getBoundingClientRect for ad test elements
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      const result = originalGetBoundingClientRect.apply(this, arguments);

      if (isAdTestElement(this)) {
        return {
          top: result.top,
          right: result.right,
          bottom: result.bottom,
          left: result.left,
          width: 300,
          height: 250,
          x: result.x,
          y: result.y,
          toJSON: () => ({})
        };
      }

      return result;
    };

    // Override offsetWidth/offsetHeight
    const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

    if (originalOffsetWidth) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
        get: function () {
          if (isAdTestElement(this)) return 300;
          return originalOffsetWidth.get.call(this);
        }
      });
    }

    if (originalOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
        get: function () {
          if (isAdTestElement(this)) return 250;
          return originalOffsetHeight.get.call(this);
        }
      });
    }
  }

  /**
   * Check if URL is an ad detection request
   */
  function isAdDetectionRequest(url) {
    if (!url) return false;

    const patterns = [
      'adblock',
      'ad-block',
      'blockadblock',
      'anti-adblock',
      'detect-adblock',
      'adblock-detector',
      'sponsor-check',
      '/ads.js',
      '/ads/check',
      '/advert/detect',
      'fuckadblock',
      'blockerdetector'
    ];

    const urlLower = url.toLowerCase();
    return patterns.some(pattern => urlLower.includes(pattern));
  }

  /**
   * Check if element is used for ad block detection
   */
  function isAdTestElement(element) {
    if (!element) return false;

    const className = element.className?.toString().toLowerCase() || '';
    const id = element.id?.toLowerCase() || '';

    const testPatterns = [
      'ad-test', 'adtest', 'adsbox', 'ad-box', 'ad_box',
      'ad-banner', 'adbanner', 'ads-banner', 'banner-ad',
      'textads', 'text-ads', 'sponsor-ads', 'doubleclick'
    ];

    return testPatterns.some(pattern =>
      className.includes(pattern) || id.includes(pattern)
    );
  }

  /**
   * Block common anti-adblock scripts
   */
  function blockAntiAdblockScripts() {
    // Override script element creation to block anti-adblock scripts
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.tagName === 'SCRIPT') {
            const src = node.src?.toLowerCase() || '';
            const content = node.textContent?.toLowerCase() || '';

            // Check for anti-adblock patterns
            const patterns = [
              'blockadblock',
              'fuckadblock',
              'anti-adblock',
              'adblock-detector',
              'adblockdetector',
              'detectadblock'
            ];

            if (patterns.some(p => src.includes(p) || content.includes(p))) {
              node.remove();
              console.log('[AdEclipse] Blocked anti-adblock script');
            }
          }
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Handle modal/overlay anti-adblock messages
   */
  function handleAntiAdblockModals() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          // Check if this is an anti-adblock modal
          const text = node.textContent?.toLowerCase() || '';
          const hasAdblockText = [
            'ad blocker',
            'adblocker',
            'ad-blocker',
            'disable your ad',
            'turn off your ad',
            'whitelist this site',
            'disable adblock'
          ].some(t => text.includes(t));

          if (hasAdblockText) {
            // Check if it's a modal/overlay
            const style = window.getComputedStyle(node);
            if (style.position === 'fixed' || style.position === 'absolute') {
              node.remove();

              // Also remove overlay
              const overlays = document.querySelectorAll('[style*="position: fixed"], [style*="position:fixed"]');
              for (const overlay of overlays) {
                const bgColor = window.getComputedStyle(overlay).backgroundColor;
                if (bgColor.includes('0, 0, 0') || bgColor.includes('rgba')) {
                  overlay.remove();
                }
              }

              // Restore scroll
              document.body.style.overflow = '';
              document.documentElement.style.overflow = '';

              console.log('[AdEclipse] Removed anti-adblock modal');
            }
          }
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Initialize anti-adblock bypass
   */
  function initialize() {
    spoofAdGlobals();
    overrideDetectionMethods();
    blockAntiAdblockScripts();

    // Wait for DOM to handle modals
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', handleAntiAdblockModals);
    } else {
      handleAntiAdblockModals();
    }
  }

  // Run immediately
  initialize();
})();
