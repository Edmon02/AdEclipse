/**
 * AdEclipse - Video Ad Interceptor
 * Detects pre-roll/interstitial video ad players on streaming/movie sites
 * and auto-skips, fast-forwards, or removes them to reach actual content.
 */

(function () {
  'use strict';

  if (window.__adeclipse_video_interceptor_loaded) return;
  window.__adeclipse_video_interceptor_loaded = true;

  const AD_VIDEO_DOMAINS = [
    'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
    'google-analytics.com', 'adservice.google.com', 'pagead2.googlesyndication.com',
    'imasdk.googleapis.com', 'youtube.com/api/stats/ads',
    'amazon-adsystem.com', 'ads.yahoo.com', 'ads.aol.com',
    'adsrvr.org', 'adform.net', 'serving-sys.com',
    'bidswitch.net', 'casalemedia.com', 'pubmatic.com',
    'springserve.com', 'spotxchange.com', 'videoadex.com',
    'innovid.com', 'extremereach.io', 'flashtalking.com',
    'cdn.adsafeprotected.com', 'moatads.com'
  ];

  const AD_CONTAINER_SELECTORS = [
    '.ima-ad-container', '.ad-container', '.video-ad', '.preroll-ad',
    '.ad-playing', '.vjs-ad-playing', '.ad-overlay', '[class*="ad-player"]',
    '[class*="adPlayer"]', '[class*="preroll"]', '[class*="midroll"]',
    '[class*="vastPlayer"]', '[id*="player_ad"]', '[id*="ad-player"]',
    '.ad-break', '[class*="ad-break"]', '.videoAdPlayer',
    '[class*="vast-"]', '[class*="vpaid-"]'
  ];

  const SKIP_BUTTON_SELECTORS = [
    '[class*="skip"]', '[id*="skip"]', '[class*="Skip"]',
    '[class*="close-ad"]', '[class*="closeAd"]', '[class*="ad-close"]',
    '[aria-label*="skip" i]', '[aria-label*="close" i]',
    '[title*="skip" i]', '[title*="close" i]',
    'button[class*="dismiss"]', '.ad-skip-button',
    '.skip-ad', '.skipBtn', '.skip-btn', '.skip_button',
    '[data-testid*="skip"]', '[class*="countdown-skip"]'
  ];

  const COUNTDOWN_SELECTORS = [
    '[class*="countdown"]', '[class*="timer"]', '[class*="remaining"]',
    '[class*="ad-timer"]', '[class*="ad-count"]'
  ];

  let config = { enabled: false };
  let observer = null;
  let pollInterval = null;
  let processedVideos = new WeakSet();
  let interceptedOverlays = new WeakSet();
  let llmCheckedVideos = new WeakSet();
  let originalFetch = null;
  let originalXHROpen = null;
  let originalXHRSend = null;
  let playerSwitchCooldownUntil = 0;

  async function initialize() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'AI_GET_CONFIG' });
      if (!response || !response.enabled) return;
      config = { ...config, ...response, enabled: true };

      interceptAdNetworkRequests();
      startVideoMonitor();
      setupDOMObserver();
    } catch (e) {
      // Extension context invalid
    }
  }

  function startVideoMonitor() {
    pollInterval = setInterval(scanForVideoAds, 800);
    scanForVideoAds();
  }

  function setupDOMObserver() {
    observer = new MutationObserver((mutations) => {
      let needsScan = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === 'VIDEO' || node.querySelector?.('video')) {
            needsScan = true;
            break;
          }
          if (matchesAny(node, AD_CONTAINER_SELECTORS)) {
            needsScan = true;
            break;
          }
        }
        if (needsScan) break;
      }
      if (needsScan) {
        setTimeout(scanForVideoAds, 100);
      }
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function scanForVideoAds() {
    autoClickSkipButtons();
    handleLocalizedAdMarkers();
    handleAdOverlays();
    handleVideoElements();
  }

  function autoClickSkipButtons() {
    const selectorString = SKIP_BUTTON_SELECTORS.join(', ');
    try {
      const buttons = document.querySelectorAll(selectorString);
      for (const btn of buttons) {
        if (!isVisible(btn)) continue;
        const text = (btn.textContent || btn.innerText || '').toLowerCase();
        if (
          /skip|close|dismiss|fermer|schlie|пропуст|закры|close ad/i.test(text) ||
          /skip|close|пропуст|закры/i.test(btn.getAttribute('aria-label') || '') ||
          /skip|close|пропуст|закры/i.test(btn.getAttribute('title') || '')
        ) {
          btn.click();
          btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
      }
    } catch (e) { /* ignore */ }
  }

  function handleLocalizedAdMarkers() {
    const bodyText = (document.body?.innerText || '').toLowerCase();
    const hasAdMarker =
      /реклама[:\s]/i.test(bodyText) ||
      /advertisement|ad\s*[:\/]\s*\d|ad\s*\d+\s*\/\s*\d+/i.test(bodyText) ||
      /осталось[:\s]\d+/i.test(bodyText);

    if (!hasAdMarker) return;

    // Force any currently playing short video to end.
    const videos = document.querySelectorAll('video');
    for (const video of videos) {
      if (!video || video.paused) continue;
      try {
        if (!isFinite(video.duration) || video.duration <= 0) continue;
        if (video.duration <= 60 || isAdVideo(video)) {
          speedUpAdVideo(video);
        }
      } catch (e) { /* ignore */ }
    }

    // If a site offers multiple mirror players, rotate when ad marker is active.
    trySwitchToAlternativePlayer();
  }

  function trySwitchToAlternativePlayer() {
    const now = Date.now();
    if (now < playerSwitchCooldownUntil) return;

    const tabCandidates = Array.from(document.querySelectorAll('button, a, li, div')).filter((el) => {
      const text = (el.textContent || '').trim().toLowerCase();
      if (!text) return false;
      if (!/плеер|player/i.test(text)) return false;
      if (text.includes('трейлер') || text.includes('trailer')) return false;
      return isVisible(el);
    });

    if (tabCandidates.length <= 1) return;

    // Pick next visible inactive tab.
    const currentIndex = tabCandidates.findIndex((el) =>
      el.classList.contains('active') || el.getAttribute('aria-selected') === 'true'
    );
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % tabCandidates.length : 0;
    const nextTab = tabCandidates[nextIndex];
    if (!nextTab) return;

    nextTab.click();
    nextTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    playerSwitchCooldownUntil = now + 6000;
  }

  function handleAdOverlays() {
    const selectorString = AD_CONTAINER_SELECTORS.join(', ');
    try {
      const overlays = document.querySelectorAll(selectorString);
      for (const overlay of overlays) {
        if (interceptedOverlays.has(overlay)) continue;
        if (!isVisible(overlay)) continue;

        interceptedOverlays.add(overlay);

        const videos = overlay.querySelectorAll('video');
        for (const video of videos) {
          speedUpAdVideo(video);
        }

        const iframes = overlay.querySelectorAll('iframe');
        for (const iframe of iframes) {
          const src = (iframe.src || '').toLowerCase();
          if (AD_VIDEO_DOMAINS.some(d => src.includes(d))) {
            iframe.src = 'about:blank';
            iframe.style.setProperty('display', 'none', 'important');
          }
        }
      }
    } catch (e) { /* ignore */ }
  }

  function handleVideoElements() {
    const videos = document.querySelectorAll('video');

    for (const video of videos) {
      if (processedVideos.has(video)) continue;

      if (isAdVideo(video)) {
        processedVideos.add(video);
        speedUpAdVideo(video);
        attachAdVideoListeners(video);
        continue;
      }

      if (!llmCheckedVideos.has(video) && isLikelyQueuedAd(video)) {
        llmCheckedVideos.add(video);
        analyzeWithLLM(video);
      }

      if (!video.__adeclipse_checked) {
        video.__adeclipse_checked = true;
        video.addEventListener('playing', function handler() {
          if (isAdVideo(video)) {
            processedVideos.add(video);
            speedUpAdVideo(video);
            attachAdVideoListeners(video);
          }
        });
      }
    }
  }

  function isAdVideo(video) {
    const src = (video.src || video.currentSrc || '').toLowerCase();
    if (AD_VIDEO_DOMAINS.some(d => src.includes(d))) return true;

    const parent = video.closest(AD_CONTAINER_SELECTORS.join(', '));
    if (parent) return true;

    const container = video.parentElement;
    if (container) {
      const attrs = `${container.id || ''} ${container.className || ''}`.toLowerCase();
      if (/\bad[-_]?(player|container|wrapper|overlay|break)\b/i.test(attrs)) return true;
      if (/\bvast\b|\bvpaid\b|\bima[-_]?\b|\bpreroll\b/i.test(attrs)) return true;
    }

    if (video.duration > 0 && video.duration <= 35) {
      const pageVideos = document.querySelectorAll('video');
      if (pageVideos.length > 1) {
        for (const other of pageVideos) {
          if (other !== video && other.duration > video.duration * 3) {
            return true;
          }
        }
      }
    }

    const sources = video.querySelectorAll('source');
    for (const source of sources) {
      const sSrc = (source.src || '').toLowerCase();
      if (AD_VIDEO_DOMAINS.some(d => sSrc.includes(d))) return true;
    }

    return false;
  }

  function isLikelyQueuedAd(video) {
    const src = (video.src || video.currentSrc || '').toLowerCase();
    if (!src) return false;

    const parentAttrs = `${video.parentElement?.id || ''} ${video.parentElement?.className || ''}`.toLowerCase();
    if (/\bplayer\b/.test(parentAttrs) && /\bad\b|\bvast\b|\bvpaid\b|\bpromo\b/.test(parentAttrs)) {
      return true;
    }

    if (video.duration > 0 && video.duration <= 45) {
      return true;
    }

    return /ad[s]?|vast|vpaid|preroll|doubleclick|googlesyndication|promo/.test(src);
  }

  function speedUpAdVideo(video) {
    try {
      video.muted = true;
      video.playbackRate = 16;
      video.volume = 0;

      Object.defineProperty(video, 'playbackRate', {
        get() { return 16; },
        set() { return 16; },
        configurable: true
      });

      if (video.duration > 0 && isFinite(video.duration)) {
        video.currentTime = video.duration - 0.1;
      }

      forceExitAdMode(video);
    } catch (e) { /* some properties may be locked */ }
  }

  function attachAdVideoListeners(video) {
    const trySkipToEnd = () => {
      try {
        if (video.duration > 0 && isFinite(video.duration)) {
          video.currentTime = video.duration - 0.1;
        }
        video.playbackRate = 16;
        video.muted = true;
        forceExitAdMode(video);
      } catch (e) { /* ignore */ }
    };

    video.addEventListener('loadedmetadata', trySkipToEnd);
    video.addEventListener('durationchange', trySkipToEnd);
    video.addEventListener('canplay', trySkipToEnd);

    video.addEventListener('ended', () => {
      autoClickSkipButtons();
      const adContainer = video.closest(AD_CONTAINER_SELECTORS.join(', '));
      if (adContainer) {
        adContainer.style.setProperty('display', 'none', 'important');
      }
      forceExitAdMode(video);
    });

    if (video.readyState >= 1) {
      trySkipToEnd();
    }
  }

  function analyzeWithLLM(videoElement) {
    const container = videoElement.closest('div, section, article') || videoElement.parentElement;
    if (!container) return;

    const descriptor = {
      tag: container.tagName.toLowerCase(),
      classes: (container.className || '').toString().split(/\s+/).filter(Boolean).slice(0, 10),
      id: container.id || undefined,
      videoSrc: (videoElement.src || videoElement.currentSrc || '').slice(0, 100),
      videoDuration: videoElement.duration || 0,
      childTags: Array.from(container.children).slice(0, 10).map(c => c.tagName.toLowerCase()),
      hasSkipButton: !!container.querySelector(SKIP_BUTTON_SELECTORS.join(', ')),
      hasCountdown: !!container.querySelector(COUNTDOWN_SELECTORS.join(', ')),
      text: (container.textContent || '').trim().slice(0, 200)
    };

    chrome.runtime.sendMessage({
      type: 'AI_SCAN_ELEMENTS',
      data: {
        elements: [{
          id: 'video_ad_check',
          ...descriptor,
          width: videoElement.clientWidth,
          height: videoElement.clientHeight,
          position: 'overlay',
          hasVideo: true,
          hasIframe: !!container.querySelector('iframe'),
          linkCount: container.querySelectorAll('a').length,
          externalLinkCount: 0
        }],
        domain: window.location.hostname
      }
    }).then(response => {
      if (response?.results?.[0]?.isAd) {
        speedUpAdVideo(videoElement);
        forceExitAdMode(videoElement);
      }
    }).catch(() => {});
  }

  function forceExitAdMode(video) {
    try {
      const playerRoot = video.closest('[class*="player"], [id*="player"], .jwplayer, .vjs-tech, .video-js');
      if (!playerRoot) return;

      const classes = [
        'ad-playing', 'ads-playing', 'vjs-ad-playing', 'ima-ad-playing',
        'ad-showing', 'ad-container-visible', 'ad-break-active'
      ];
      for (const cls of classes) {
        playerRoot.classList.remove(cls);
      }

      for (const selector of AD_CONTAINER_SELECTORS) {
        playerRoot.querySelectorAll(selector).forEach((el) => {
          el.style.setProperty('display', 'none', 'important');
          el.style.setProperty('pointer-events', 'none', 'important');
          el.style.setProperty('opacity', '0', 'important');
        });
      }

      const countdownNodes = playerRoot.querySelectorAll(COUNTDOWN_SELECTORS.join(', '));
      countdownNodes.forEach((node) => node.remove());
    } catch (e) { /* ignore */ }
  }

  function interceptAdNetworkRequests() {
    try {
      if (!window.fetch || originalFetch) return;
      originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const input = args[0];
        const url = typeof input === 'string' ? input : (input?.url || '');
        if (shouldBlockAdRequest(url)) {
          return new Response('', { status: 204, statusText: 'No Content' });
        }
        return originalFetch(...args);
      };
    } catch (e) { /* ignore */ }

    try {
      if (!window.XMLHttpRequest || originalXHROpen) return;
      originalXHROpen = XMLHttpRequest.prototype.open;
      originalXHRSend = XMLHttpRequest.prototype.send;

      XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__adeclipse_request_url = typeof url === 'string' ? url : '';
        return originalXHROpen.call(this, method, url, ...rest);
      };

      XMLHttpRequest.prototype.send = function (...args) {
        if (shouldBlockAdRequest(this.__adeclipse_request_url || '')) {
          this.abort();
          return;
        }
        return originalXHRSend.call(this, ...args);
      };
    } catch (e) { /* ignore */ }
  }

  function shouldBlockAdRequest(url) {
    if (!url) return false;
    const lower = url.toLowerCase();

    if (AD_VIDEO_DOMAINS.some((d) => lower.includes(d))) return true;
    if (/\/(ads?|adserver|vast|vpaid|preroll|midroll|adbreak)\b/.test(lower)) return true;
    if (/[?&](ad|ads|ad_unit|adunit|adtag|vast|vpaid|preroll)=/.test(lower)) return true;

    return false;
  }

  function matchesAny(element, selectors) {
    try {
      return element.matches && element.matches(selectors.join(', '));
    } catch (e) {
      return false;
    }
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
})();
