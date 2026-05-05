/**
 * AdEclipse - Main World Player Patch
 * Runs in page context to neutralize common ad loaders before they queue pre-rolls.
 */
(function () {
  'use strict';

  if (window.__adeclipse_mainworld_patch_loaded) return;
  window.__adeclipse_mainworld_patch_loaded = true;

  const AD_URL_PATTERN = /doubleclick|googlesyndication|googleadservices|adservice|\/ads?\/|[?&](ad|ads|adtag|vast|vpaid|preroll|midroll)=|vast|vpaid|preroll|midroll|ima/i;
  const MEDIA_URL_PATTERN = /\.(m3u8|mpd|mp4|webm|mkv)(\?|$)/i;

  let lastLikelyContentUrl = '';
  const blockedLog = new Set();

  function isAdUrl(url) {
    return !!url && AD_URL_PATTERN.test(String(url));
  }

  function isLikelyMediaUrl(url) {
    return !!url && MEDIA_URL_PATTERN.test(String(url));
  }

  function rememberContentUrl(url) {
    if (url && isLikelyMediaUrl(url) && !isAdUrl(url)) {
      lastLikelyContentUrl = url;
    }
  }

  function logOnce(key, msg) {
    if (blockedLog.has(key)) return;
    blockedLog.add(key);
    console.info('[AdEclipse MainPatch]', msg);
  }

  function patchFetch() {
    if (!window.fetch) return;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const req = args[0];
      const url = typeof req === 'string' ? req : (req?.url || '');

      if (isLikelyMediaUrl(url) && !isAdUrl(url)) {
        rememberContentUrl(url);
      }

      if (isAdUrl(url)) {
        logOnce(`fetch:${url}`, `blocked ad fetch ${url.slice(0, 140)}`);
        if (lastLikelyContentUrl && isLikelyMediaUrl(url)) {
          return originalFetch(lastLikelyContentUrl, ...args.slice(1));
        }
        return new Response('', { status: 204, statusText: 'No Content' });
      }

      return originalFetch(...args);
    };
  }

  function patchXHR() {
    if (!window.XMLHttpRequest) return;
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__adeclipse_url = String(url || '');
      if (isLikelyMediaUrl(this.__adeclipse_url) && !isAdUrl(this.__adeclipse_url)) {
        rememberContentUrl(this.__adeclipse_url);
      }
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      const url = this.__adeclipse_url || '';
      if (isAdUrl(url)) {
        logOnce(`xhr:${url}`, `blocked ad xhr ${url.slice(0, 140)}`);
        this.abort();
        return;
      }
      return originalSend.call(this, ...args);
    };
  }

  function patchMediaElementSrc() {
    const proto = HTMLMediaElement?.prototype;
    if (!proto) return;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'src');
    if (!descriptor?.set || !descriptor?.get) return;

    Object.defineProperty(proto, 'src', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: function () {
        return descriptor.get.call(this);
      },
      set: function (value) {
        const url = String(value || '');
        if (!url) return descriptor.set.call(this, value);

        if (isAdUrl(url)) {
          logOnce(`video-src:${url}`, `blocked media src ${url.slice(0, 140)}`);
          if (lastLikelyContentUrl) {
            return descriptor.set.call(this, lastLikelyContentUrl);
          }
          return;
        }

        rememberContentUrl(url);
        return descriptor.set.call(this, value);
      }
    });
  }

  function patchAppendChild() {
    const originalAppend = Element.prototype.appendChild;
    Element.prototype.appendChild = function (child) {
      try {
        if (child?.tagName === 'SOURCE' || child?.tagName === 'IFRAME') {
          const url = child.src || child.getAttribute?.('src') || '';
          if (isAdUrl(url)) {
            logOnce(`append:${url}`, `blocked ad node append ${url.slice(0, 140)}`);
            return child;
          }
          rememberContentUrl(url);
        }
      } catch (e) {
        // ignore
      }
      return originalAppend.call(this, child);
    };
  }

  function patchJwPlayer() {
    const patchSetup = (jwplayerFn) => {
      if (!jwplayerFn || jwplayerFn.__adeclipse_patched) return;
      jwplayerFn.__adeclipse_patched = true;

      const wrapPlayer = (player) => {
        if (!player || player.__adeclipse_player_patched) return player;
        player.__adeclipse_player_patched = true;

        if (typeof player.setup === 'function') {
          const originalSetup = player.setup.bind(player);
          player.setup = (config = {}) => {
            const safeConfig = { ...config };
            delete safeConfig.advertising;
            delete safeConfig.adSchedule;
            delete safeConfig.adTagUrl;
            delete safeConfig.ima;
            delete safeConfig.preloadAds;

            if (Array.isArray(safeConfig.sources)) {
              safeConfig.sources = safeConfig.sources.filter((s) => !isAdUrl(s?.file || s?.src || ''));
              const firstSource = safeConfig.sources[0]?.file || safeConfig.sources[0]?.src;
              rememberContentUrl(firstSource || '');
            }

            return originalSetup(safeConfig);
          };
        }

        return player;
      };

      const wrapped = function (...args) {
        const player = jwplayerFn(...args);
        return wrapPlayer(player);
      };

      Object.keys(jwplayerFn).forEach((k) => {
        try {
          wrapped[k] = jwplayerFn[k];
        } catch (e) {
          // ignore readonly props
        }
      });

      window.jwplayer = wrapped;
    };

    if (window.jwplayer) patchSetup(window.jwplayer);

    try {
      let _jwplayer = window.jwplayer;
      Object.defineProperty(window, 'jwplayer', {
        configurable: true,
        get() {
          return _jwplayer;
        },
        set(v) {
          _jwplayer = v;
          patchSetup(v);
        }
      });
    } catch (e) {
      // property may be non-configurable
    }
  }

  function patchVideoJs() {
    const patch = (videojs) => {
      if (!videojs || videojs.__adeclipse_patched) return;
      videojs.__adeclipse_patched = true;
      const original = videojs;

      const wrapped = function (...args) {
        const player = original(...args);
        if (player && !player.__adeclipse_player_patched) {
          player.__adeclipse_player_patched = true;
          // disable common ad plugins
          player.ima = function () { return player; };
          player.vastClient = function () { return player; };
          player.adScheduler = function () { return player; };
          player.ads = function () { return player; };
        }
        return player;
      };

      Object.keys(original).forEach((k) => {
        try {
          wrapped[k] = original[k];
        } catch (e) {
          // ignore readonly props
        }
      });

      window.videojs = wrapped;
    };

    if (window.videojs) patch(window.videojs);
  }

  function patchHls() {
    const patch = (Hls) => {
      if (!Hls || Hls.__adeclipse_patched) return;
      Hls.__adeclipse_patched = true;
      const proto = Hls.prototype;
      if (!proto) return;

      const originalLoadSource = proto.loadSource;
      if (typeof originalLoadSource === 'function') {
        proto.loadSource = function (url) {
          const src = String(url || '');
          if (isAdUrl(src)) {
            logOnce(`hls:${src}`, `blocked hls ad source ${src.slice(0, 140)}`);
            if (lastLikelyContentUrl) {
              return originalLoadSource.call(this, lastLikelyContentUrl);
            }
            return;
          }
          rememberContentUrl(src);
          return originalLoadSource.call(this, url);
        };
      }
    };

    if (window.Hls) patch(window.Hls);

    try {
      let _Hls = window.Hls;
      Object.defineProperty(window, 'Hls', {
        configurable: true,
        get() {
          return _Hls;
        },
        set(v) {
          _Hls = v;
          patch(v);
        }
      });
    } catch (e) {
      // ignore
    }
  }

  function patchShaka() {
    if (!window.shaka?.Player?.prototype) return;
    const proto = window.shaka.Player.prototype;
    if (proto.__adeclipse_patched) return;
    proto.__adeclipse_patched = true;

    const originalLoad = proto.load;
    if (typeof originalLoad === 'function') {
      proto.load = function (url, ...rest) {
        const src = String(url || '');
        if (isAdUrl(src)) {
          logOnce(`shaka:${src}`, `blocked shaka ad source ${src.slice(0, 140)}`);
          if (lastLikelyContentUrl) {
            return originalLoad.call(this, lastLikelyContentUrl, ...rest);
          }
          return Promise.resolve();
        }
        rememberContentUrl(src);
        return originalLoad.call(this, url, ...rest);
      };
    }
  }

  function removeVisibleAdOverlays() {
    const selectors = [
      '[class*="ad-overlay"]', '[id*="ad-overlay"]',
      '[class*="preroll"]', '[class*="ad-break"]',
      '[class*="ima-ad"]', '[class*="vast"]', '[class*="vpaid"]'
    ];
    document.querySelectorAll(selectors.join(',')).forEach((el) => {
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('opacity', '0', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
    });
  }

  function bootstrap() {
    patchFetch();
    patchXHR();
    patchMediaElementSrc();
    patchAppendChild();
    patchJwPlayer();
    patchVideoJs();
    patchHls();
    patchShaka();
    setInterval(removeVisibleAdOverlays, 700);
  }

  bootstrap();
})();
