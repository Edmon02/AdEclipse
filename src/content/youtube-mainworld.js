/**
 * AdEclipse - YouTube Main World Patch
 * Runs in MAIN world to sanitize YouTube player payloads before ad UI is built.
 */
(function() {
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
    'adSignalsInfo'
  ];

  const isTargetYoutubeiRequest = (url) => (
    url.includes('/youtubei/v1/player') ||
    url.includes('/youtubei/v1/next') ||
    url.includes('/youtubei/v1/reel/reel_watch_sequence') ||
    url.includes('/youtubei/v1/browse')
  );

  const cleanseObject = (obj, seen = new WeakSet()) => {
    if (!obj || typeof obj !== 'object') return obj;
    if (seen.has(obj)) return obj;
    seen.add(obj);

    if (Array.isArray(obj)) {
      for (const item of obj) cleanseObject(item, seen);
      return obj;
    }

    for (const key of AD_KEYS) {
      if (key in obj) delete obj[key];
    }

    if (Array.isArray(obj.adPlacements)) obj.adPlacements = [];
    if (Array.isArray(obj.playerAds)) obj.playerAds = [];

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
    } catch (_) {}
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
    } catch (_) {}
  };

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

  patchInitialResponse();
  patchInitialPlayerResponseSetter();
  patchFetch();
  patchXhr();
})();
