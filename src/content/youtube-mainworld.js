/**
 * AdEclipse - YouTube Main World Patch
 * Runs in MAIN world to sanitize YouTube player payloads before ad UI is built.
 * Also provides MAIN-world player API access for direct ad skipping.
 */
(function () {
  'use strict';

  if (window.__ADECLIPSE_YT_MAINWORLD__) return;
  window.__ADECLIPSE_YT_MAINWORLD__ = true;

  const AD_KEYS = [
    'adPlacements',
    'playerAds',
    'adSlots',
    'adBreakHeartbeatParams',
    'adSafetyReason',
    'streamingAds',
    'ad3Module',
    'adState',
    'adBreakParams',
    'adModule',
    'adPlaybackContext',
    'adVideoId',
    'adLayoutLoggingData',
    'adInfoRenderer',
    'adNextParams',
    'instreamVideoAdRenderer',
    'linearAdSequenceRenderer',
    'adSignalsInfo',
    // Additional keys for modern YouTube ad payloads
    'adBreakServiceRenderer',
    'adSlotRenderer',
    'adBreakRenderer',
    'advertiserInfoRenderer',
    'promotedSparklesWebRenderer',
    'promotedSparklesTextSearchRenderer',
    'compactPromotedVideoRenderer',
    'promotedVideoRenderer',
    'playerLegacyDesktopWatchAdsRenderer',
    'actionCompanionAdRenderer',
    'adPlacementConfig',
    'adPlacementRenderer',
    'instreamAdPlayerOverlayRenderer',
    'invideoOverlayAdRenderer',
    'adActionInterstitialRenderer',
    'adFeedbackRenderer',
    'adSlotAndLayout',
    'adSlotMetadata',
    'adLayoutMetadata',
    'adLayoutRenderData',
    'adHoverTextButtonRenderer',
    'adInfoDialogRenderer',
    'adReasonRenderer'
  ];

  // Keys whose array children should be scanned for ad renderer items
  const AD_RENDERER_PATTERNS = [
    'adSlotRenderer',
    'promotedSparkles',
    'promotedVideo',
    'displayAd',
    'inFeedAdLayout',
    'CompanionAd',
    'companionAd',
    'adSlot',
    'searchPyv'
  ];

  const isTargetYoutubeiRequest = (url) => (
    url.includes('/youtubei/v1/player') ||
    url.includes('/youtubei/v1/next') ||
    url.includes('/youtubei/v1/reel/reel_watch_sequence') ||
    url.includes('/youtubei/v1/browse') ||
    url.includes('/youtubei/v1/ad_break')
  );

  const cleanseObject = (obj, seen = new WeakSet()) => {
    if (!obj || typeof obj !== 'object') return obj;
    if (seen.has(obj)) return obj;
    seen.add(obj);

    if (Array.isArray(obj)) {
      for (const item of obj) cleanseObject(item, seen);
      return obj;
    }

    // Delete known ad keys
    for (const key of AD_KEYS) {
      if (key in obj) delete obj[key];
    }

    if (Array.isArray(obj.adPlacements)) obj.adPlacements = [];
    if (Array.isArray(obj.playerAds)) obj.playerAds = [];

    // Filter ad renderer items out of content arrays
    const ARRAY_KEYS = ['contents', 'items', 'results', 'richItems'];
    for (const arrKey of ARRAY_KEYS) {
      if (Array.isArray(obj[arrKey])) {
        obj[arrKey] = obj[arrKey].filter(function (item) {
          if (!item || typeof item !== 'object') return true;
          var itemKeys = Object.keys(item);
          return !itemKeys.some(function (k) {
            return AD_RENDERER_PATTERNS.some(function (pat) {
              return k.includes(pat);
            });
          });
        });
      }
    }

    if (obj.playabilityStatus && typeof obj.playabilityStatus === 'object') {
      const reason = String(obj.playabilityStatus.reason || '').toLowerCase();
      if (obj.playabilityStatus.status === 'ERROR' && reason.includes('ad')) {
        delete obj.playabilityStatus;
      }
    }

    for (const value of Object.values(obj)) {
      cleanseObject(value, seen);
    }

    return obj;
  };

  const cloneHeaders = (headers) => {
    const next = new Headers();
    headers.forEach((value, key) => next.set(key, value));
    next.delete('content-length');
    return next;
  };

  const buildJsonResponse = (json, origin) => new Response(JSON.stringify(json), {
    status: origin.status,
    statusText: origin.statusText,
    headers: cloneHeaders(origin.headers)
  });

  const patchInitialResponse = () => {
    try {
      if (window.ytInitialPlayerResponse) {
        cleanseObject(window.ytInitialPlayerResponse);
      }
    } catch (_) { }
    try {
      if (window.ytInitialData) {
        cleanseObject(window.ytInitialData);
      }
    } catch (_) { }
  };

  const patchInitialPlayerResponseSetter = () => {
    try {
      let current = window.ytInitialPlayerResponse;
      Object.defineProperty(window, 'ytInitialPlayerResponse', {
        configurable: true,
        get() {
          return current;
        },
        set(value) {
          current = cleanseObject(value);
        }
      });
    } catch (_) { }
  };

  const patchInitialDataSetter = () => {
    try {
      let currentData = window.ytInitialData;
      Object.defineProperty(window, 'ytInitialData', {
        configurable: true,
        get() {
          return currentData;
        },
        set(value) {
          currentData = cleanseObject(value);
        }
      });
    } catch (_) { }
  };

  const patchFetch = () => {
    const originalFetch = window.fetch;
    window.fetch = async function (input, init) {
      const response = await originalFetch.call(this, input, init);
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (!isTargetYoutubeiRequest(url)) return response;

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) return response;

        const json = await response.clone().json();
        cleanseObject(json);
        return buildJsonResponse(json, response);
      } catch (_) {
        return response;
      }
    };
  };

  const patchXhr = () => {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__adeclipseUrl = String(url || '');
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      if (this.__adeclipseUrl && isTargetYoutubeiRequest(this.__adeclipseUrl)) {
        this.addEventListener('readystatechange', () => {
          if (this.readyState !== 4) return;
          try {
            if (typeof this.responseText !== 'string' || !this.responseText) return;
            const parsed = JSON.parse(this.responseText);
            cleanseObject(parsed);
            const serialized = JSON.stringify(parsed);

            try {
              Object.defineProperty(this, 'responseText', { configurable: true, value: serialized });
            } catch (_) { }
            try {
              Object.defineProperty(this, 'response', { configurable: true, value: serialized });
            } catch (_) { }
          } catch (_) { }
        });
      }

      return originalSend.apply(this, args);
    };
  };

  /* ── MAIN-world player API ad skipper ──────────────────────────── */

  const installMainWorldAdSkipper = () => {
    const trySkip = () => {
      try {
        var player = document.getElementById('movie_player');
        if (!player) return;

        // These methods exist on YouTube's internal player API (MAIN world only)
        if (typeof player.skipAd === 'function') player.skipAd();
        if (typeof player.cancelPlayback === 'function') player.cancelPlayback();

        // Access internal player API for ad-specific control
        if (typeof player.getVideoData === 'function') {
          var vd = player.getVideoData();
          if (vd && vd.isAd) {
            var video = player.querySelector('video');
            if (video && Number.isFinite(video.duration) && video.duration > 0 && video.duration < 300) {
              if (typeof player.seekTo === 'function') {
                player.seekTo(video.duration, true);
              }
            }
          }
        }
      } catch (_) { }
    };

    const watchPlayer = () => {
      var player = document.getElementById('movie_player');
      if (!player) {
        setTimeout(watchPlayer, 100);
        return;
      }

      // Observe class changes for ad state
      new MutationObserver(function () {
        if (player.classList.contains('ad-showing') ||
          player.classList.contains('ad-interrupting')) {
          trySkip();
        }
      }).observe(player, { attributes: true, attributeFilter: ['class'] });

      // Also poll for reliability
      setInterval(function () {
        if (player.classList.contains('ad-showing') ||
          player.classList.contains('ad-interrupting')) {
          trySkip();
        }
      }, 100);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', watchPlayer);
    } else {
      watchPlayer();
    }
  };

  /* ── Bootstrap ─────────────────────────────────────────────────── */

  patchInitialResponse();
  patchInitialPlayerResponseSetter();
  patchInitialDataSetter();
  patchFetch();
  patchXhr();
  installMainWorldAdSkipper();
})();
