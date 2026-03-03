/**
 * AdEclipse - YouTube Main World Patch
 * Runs in MAIN world to sanitize YouTube player payloads before ad UI is built.
 * Also provides MAIN-world player API access for direct ad skipping.
 *
 * Interception layers (each catches what the others might miss):
 *   1. JSON.parse          – catches ALL deserialized JSON globally
 *   2. Response.prototype.json – catches fetch().json() calls
 *   3. fetch() wrapper     – catches YouTubei API fetch responses
 *   4. XHR wrapper         – catches YouTubei API XHR responses
 *   5. ytInitialPlayerResponse / ytInitialData property traps
 *   6. MAIN-world player API skip (MutationObserver + poll fallback)
 */
(function() {
  'use strict';

  if (window.__ADECLIPSE_YT_MAINWORLD__) return;
  window.__ADECLIPSE_YT_MAINWORLD__ = true;

  /* ── Fixed ad key set (fast O(1) lookup) ───────────────────────── */

  const AD_KEYS = new Set([
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
  ]);

  // Regex catches any FUTURE ad keys YouTube may add
  const AD_KEY_PATTERN = /^(?:ad[A-Z]|playerAd)|(?:Ad(?:Renderer|Module|Layout|Config|Slot|Break|Placement|Overlay)$)/;

  // Patterns for filtering ad renderer items out of content arrays
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

  /* ── Core cleansing function ───────────────────────────────────── */

  const cleanseObject = (obj, seen) => {
    if (!obj || typeof obj !== 'object') return obj;
    if (!seen) seen = new WeakSet();
    if (seen.has(obj)) return obj;
    seen.add(obj);

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) cleanseObject(obj[i], seen);
      return obj;
    }

    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      // Fixed set check (O(1)) + regex check (catches future keys)
      if (AD_KEYS.has(key) || AD_KEY_PATTERN.test(key)) {
        delete obj[key];
      }
    }

    // Empty arrays that might have survived deletion
    if (Array.isArray(obj.adPlacements)) obj.adPlacements = [];
    if (Array.isArray(obj.playerAds)) obj.playerAds = [];

    // Filter ad renderer items out of content arrays
    const ARRAY_KEYS = ['contents', 'items', 'results', 'richItems'];
    for (let a = 0; a < ARRAY_KEYS.length; a++) {
      const arrKey = ARRAY_KEYS[a];
      if (Array.isArray(obj[arrKey])) {
        obj[arrKey] = obj[arrKey].filter(function(item) {
          if (!item || typeof item !== 'object') return true;
          const itemKeys = Object.keys(item);
          for (let j = 0; j < itemKeys.length; j++) {
            const k = itemKeys[j];
            for (let p = 0; p < AD_RENDERER_PATTERNS.length; p++) {
              if (k.includes(AD_RENDERER_PATTERNS[p])) return false;
            }
          }
          return true;
        });
      }
    }

    // Remove ad-caused playability errors
    if (obj.playabilityStatus && typeof obj.playabilityStatus === 'object') {
      const reason = String(obj.playabilityStatus.reason || '').toLowerCase();
      if (obj.playabilityStatus.status === 'ERROR' && reason.includes('ad')) {
        delete obj.playabilityStatus;
      }
    }

    // Recurse into remaining values
    const values = Object.values(obj);
    for (let i = 0; i < values.length; i++) {
      cleanseObject(values[i], seen);
    }

    return obj;
  };

  /* ── Layer 1: JSON.parse interception ──────────────────────────── */
  // This is the most comprehensive layer. ALL YouTube JSON (initial page data,
  // fetch responses, XHR responses) goes through JSON.parse. By cleansing here,
  // no ad data ever reaches YouTube's code regardless of transport mechanism.

  const patchJsonParse = () => {
    const originalParse = JSON.parse;
    JSON.parse = function(text, reviver) {
      const result = originalParse.call(this, text, reviver);
      if (result && typeof result === 'object') {
        cleanseObject(result);
      }
      return result;
    };
    // Preserve identity
    JSON.parse.toString = () => 'function parse() { [native code] }';
  };

  /* ── Layer 2: Response.prototype.json interception ─────────────── */
  // Catches fetch(...).then(r => r.json()) before YouTube reads it.

  const patchResponseJson = () => {
    const originalJson = Response.prototype.json;
    Response.prototype.json = async function() {
      const result = await originalJson.call(this);
      if (result && typeof result === 'object') {
        cleanseObject(result);
      }
      return result;
    };
  };

  /* ── Layer 3: fetch() wrapper ──────────────────────────────────── */
  // Specifically targets YouTubei API endpoints for full response replacement.

  const isTargetYoutubeiRequest = (url) => (
    url.includes('/youtubei/v1/player') ||
    url.includes('/youtubei/v1/next') ||
    url.includes('/youtubei/v1/reel/reel_watch_sequence') ||
    url.includes('/youtubei/v1/browse') ||
    url.includes('/youtubei/v1/ad_break')
  );

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

  const patchFetch = () => {
    const originalFetch = window.fetch;
    window.fetch = async function(input, init) {
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

  /* ── Layer 4: XHR wrapper ──────────────────────────────────────── */

  const patchXhr = () => {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this.__adeclipseUrl = String(url || '');
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function(...args) {
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
            } catch (_) {}
            try {
              Object.defineProperty(this, 'response', { configurable: true, value: serialized });
            } catch (_) {}
          } catch (_) {}
        });
      }

      return originalSend.apply(this, args);
    };
  };

  /* ── Layer 5: Property traps for initial page data ─────────────── */

  const patchInitialResponse = () => {
    try {
      if (window.ytInitialPlayerResponse) {
        cleanseObject(window.ytInitialPlayerResponse);
      }
    } catch (_) {}
    try {
      if (window.ytInitialData) {
        cleanseObject(window.ytInitialData);
      }
    } catch (_) {}
  };

  const patchInitialPlayerResponseSetter = () => {
    try {
      let current = window.ytInitialPlayerResponse;
      Object.defineProperty(window, 'ytInitialPlayerResponse', {
        configurable: true,
        get() { return current; },
        set(value) { current = cleanseObject(value); }
      });
    } catch (_) {}
  };

  const patchInitialDataSetter = () => {
    try {
      let currentData = window.ytInitialData;
      Object.defineProperty(window, 'ytInitialData', {
        configurable: true,
        get() { return currentData; },
        set(value) { currentData = cleanseObject(value); }
      });
    } catch (_) {}
  };

  /* ── Layer 6: MAIN-world player API ad skipper (fallback) ──────── */
  // If any ad data still leaks through, this provides instant skip via
  // YouTube's own internal player API methods (only accessible in MAIN world).

  const installMainWorldAdSkipper = () => {
    const trySkip = () => {
      try {
        const player = document.getElementById('movie_player');
        if (!player) return;

        if (typeof player.skipAd === 'function') player.skipAd();
        if (typeof player.cancelPlayback === 'function') player.cancelPlayback();

        if (typeof player.getVideoData === 'function') {
          const vd = player.getVideoData();
          if (vd && vd.isAd) {
            const video = player.querySelector('video');
            if (video && Number.isFinite(video.duration) && video.duration > 0 && video.duration < 300) {
              if (typeof player.seekTo === 'function') {
                player.seekTo(video.duration, true);
              }
            }
          }
        }
      } catch (_) {}
    };

    const watchPlayer = () => {
      const player = document.getElementById('movie_player');
      if (!player) {
        setTimeout(watchPlayer, 100);
        return;
      }

      new MutationObserver(function() {
        if (player.classList.contains('ad-showing') ||
            player.classList.contains('ad-interrupting')) {
          trySkip();
        }
      }).observe(player, { attributes: true, attributeFilter: ['class'] });

      setInterval(function() {
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
  // Order matters: JSON.parse + Response.json FIRST (global coverage),
  // then property traps, then transport-specific patches, then fallback skipper.

  patchJsonParse();
  patchResponseJson();
  patchInitialResponse();
  patchInitialPlayerResponseSetter();
  patchInitialDataSetter();
  patchFetch();
  patchXhr();
  installMainWorldAdSkipper();
})();
