/**
 * AdEclipse - YouTube Main World Patch
 * Runs in MAIN world at document_start and strips ad pods from player
 * payloads before the player schedules them. Player requests also ask for
 * playback without an ad, so the video stream is not given the wait that
 * YouTube shows as "Experiencing interruptions?".
 *
 * The page keeps these wrappers until it reloads. A non-enumerable flag and
 * the yt-player-ctl event let the extension put the originals back when it
 * is turned off, and a missed heartbeat does the same after uninstall.
 */
(function () {
  'use strict';

  const MARK = 'ytPlayerCtl';
  const CTL = 'yt-player-ctl';
  if (window[MARK] && window[MARK].active) return;
  const mark = { active: true };
  try {
    Object.defineProperty(window, MARK, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: mark
    });
  } catch (_) { }

  let released = false;
  const restorers = [];
  const observers = [];

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

  // Array items whose own keys contain one of these are ad renderers
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

  const ARRAY_KEYS = ['contents', 'items', 'results', 'richItems'];

  // Player responses are ~30 levels deep; the caps bound worst-case work
  const MAX_DEPTH = 48;
  const MAX_NODES = 200000;

  // get_watch is the combined player + next payload used for in-app navigation
  const TARGET_PATH = /^\/youtubei\/v1\/(?:player(?:\/ad_break)?|next|get_watch|reel\/reel_watch_sequence)$/;

  const isTargetUrl = (url) => {
    if (!url) return false;
    try {
      return TARGET_PATH.test(new URL(String(url), location.href).pathname);
    } catch (_) {
      return false;
    }
  };

  const isAdItem = (item) => {
    if (!item || typeof item !== 'object') return false;
    for (const k in item) {
      for (const pat of AD_RENDERER_PATTERNS) {
        if (k.includes(pat)) return true;
      }
    }
    return false;
  };

  /**
   * Remove ad fields in place. Iterative so a large payload cannot overflow
   * the stack. Returns the number of removals.
   */
  const cleanse = (root) => {
    if (!root || typeof root !== 'object') return 0;
    let removed = 0;
    let visited = 0;
    const stack = [root, 0];

    while (stack.length && visited < MAX_NODES) {
      const depth = stack.pop();
      const obj = stack.pop();
      visited++;

      if (Array.isArray(obj)) {
        if (depth < MAX_DEPTH) {
          for (let i = 0; i < obj.length; i++) {
            const v = obj[i];
            if (v && typeof v === 'object') stack.push(v, depth + 1);
          }
        }
        continue;
      }

      for (const key of AD_KEYS) {
        if (key in obj) {
          delete obj[key];
          removed++;
        }
      }

      for (const arrKey of ARRAY_KEYS) {
        const arr = obj[arrKey];
        if (Array.isArray(arr) && arr.some(isAdItem)) {
          const kept = arr.filter((item) => !isAdItem(item));
          removed += arr.length - kept.length;
          obj[arrKey] = kept;
        }
      }

      if (depth < MAX_DEPTH) {
        for (const k in obj) {
          const v = obj[k];
          if (v && typeof v === 'object') stack.push(v, depth + 1);
        }
      }
    }

    return removed;
  };

  /* ── Native-looking wrappers ───────────────────────────────── */

  const nativeToString = Function.prototype.toString;

  const mask = (wrapper, original) => {
    try {
      Object.defineProperty(wrapper, 'name', { value: original.name, configurable: true });
      Object.defineProperty(wrapper, 'length', { value: original.length, configurable: true });
      Object.defineProperty(wrapper, 'toString', {
        value: nativeToString.bind(original),
        writable: true,
        configurable: true
      });
    } catch (_) { }
    return wrapper;
  };

  /**
   * Ask for a stream with no ad attached. When a response includes an ad,
   * the content stream is told to wait for most of that ad; skipping the ad
   * leaves the wait, which the player reports as an interruption.
   */
  const NO_AD_FLAG = '"isInlinePlaybackNoAd":true';
  const PLAYBACK_CONTEXT_KEY = '"contentPlaybackContext":{';

  const markNoAdBody = (body) => {
    if (typeof body !== 'string' || !body.includes(PLAYBACK_CONTEXT_KEY) || body.includes(NO_AD_FLAG)) {
      return body;
    }
    return body.replace(PLAYBACK_CONTEXT_KEY, '"contentPlaybackContext":{' + NO_AD_FLAG + ',');
  };

  const patchOutbound = () => {
    const pageJSON = window.JSON;
    const pageObject = window.Object;
    if (!pageJSON || !pageObject) return;

    const originalStringify = pageJSON.stringify;
    const originalAssign = pageObject.assign;
    if (typeof originalStringify !== 'function' || typeof originalAssign !== 'function') return;

    const stringify = function (value, replacer, space) {
      if (released) return originalStringify.apply(this, arguments);
      const ctx = value && value.playbackContext && value.playbackContext.contentPlaybackContext;
      if (ctx && typeof ctx === 'object' && !ctx.isInlinePlaybackNoAd) {
        const next = originalAssign({}, value, {
          playbackContext: originalAssign({}, value.playbackContext, {
            contentPlaybackContext: originalAssign({}, ctx, { isInlinePlaybackNoAd: true })
          })
        });
        return originalStringify.call(this, next, replacer, space);
      }
      return originalStringify.apply(this, arguments);
    };

    // YouTube locks JSON.stringify. Object.assign still builds the request.
    const assign = function () {
      const result = originalAssign.apply(this, arguments);
      if (released) return result;
      try {
        if (result && typeof result.body === 'string') {
          const marked = markNoAdBody(result.body);
          if (marked !== result.body) result.body = marked;
        }
      } catch (_) { }
      return result;
    };

    try { pageJSON.stringify = mask(stringify, originalStringify); } catch (_) { }
    try { pageObject.assign = mask(assign, originalAssign); } catch (_) { }
    restorers.push(() => {
      try { pageJSON.stringify = originalStringify; } catch (_) { }
      try { pageObject.assign = originalAssign; } catch (_) { }
    });
  };

  /* ── Initial player response ───────────────────────────────── */

  const patchInitialPlayerResponse = () => {
    try {
      let current = window.ytInitialPlayerResponse;
      if (current) cleanse(current);

      Object.defineProperty(window, 'ytInitialPlayerResponse', {
        configurable: true,
        enumerable: true,
        get() { return current; },
        set(value) {
          if (!released) cleanse(value);
          current = value;
        }
      });
      restorers.push(() => {
        const value = current;
        try {
          delete window.ytInitialPlayerResponse;
          window.ytInitialPlayerResponse = value;
        } catch (_) { }
      });
    } catch (_) { }
  };

  /* ── fetch ─────────────────────────────────────────────────── */

  const patchFetch = () => {
    const originalFetch = window.fetch;
    if (typeof originalFetch !== 'function') return;

    const fetch = function (input, init) {
      if (released) return originalFetch.apply(this, arguments);
      const url = typeof input === 'string' ? input : (input && input.url) || String(input || '');
      let nextInit = init;
      if (init && typeof init.body === 'string') {
        const marked = markNoAdBody(init.body);
        if (marked !== init.body) nextInit = { ...init, body: marked };
      }
      const pending = nextInit === init
        ? originalFetch.apply(this, arguments)
        : originalFetch.call(this, input, nextInit);
      if (!isTargetUrl(url)) return pending;

      return pending.then(async (response) => {
        try {
          const type = response.headers.get('content-type') || '';
          if (!response.ok || !type.includes('application/json')) return response;

          const json = await response.clone().json();
          if (!cleanse(json)) return response;

          const headers = new Headers(response.headers);
          headers.delete('content-length');
          const cleaned = new Response(JSON.stringify(json), {
            status: response.status,
            statusText: response.statusText,
            headers
          });
          try {
            Object.defineProperty(cleaned, 'url', { value: response.url });
          } catch (_) { }
          return cleaned;
        } catch (_) {
          return response;
        }
      });
    };

    window.fetch = mask(fetch, originalFetch);
    restorers.push(() => {
      try { window.fetch = originalFetch; } catch (_) { }
    });
  };

  /* ── XMLHttpRequest ────────────────────────────────────────── */

  const patchXhr = () => {
    if (typeof XMLHttpRequest !== 'function') return;
    const proto = XMLHttpRequest.prototype;
    const targets = new WeakMap();

    const originalOpen = proto.open;
    const savedGets = [];
    const open = function (method, url) {
      if (released) return originalOpen.apply(this, arguments);
      if (isTargetUrl(url)) targets.set(this, null);
      else targets.delete(this);
      return originalOpen.apply(this, arguments);
    };
    proto.open = mask(open, originalOpen);

    const cleanedText = (xhr, rawText) => {
      const cached = targets.get(xhr);
      if (cached && cached.raw === rawText) return cached.text;
      let text = rawText;
      try {
        const parsed = JSON.parse(rawText);
        if (cleanse(parsed)) text = JSON.stringify(parsed);
      } catch (_) { }
      targets.set(xhr, { raw: rawText, text });
      return text;
    };

    const wrapGetter = (prop, transform) => {
      const desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (!desc || typeof desc.get !== 'function') return;
      savedGets.push({ prop, desc });
      const originalGet = desc.get;
      const get = function () {
        const value = originalGet.call(this);
        if (released || !targets.has(this) || this.readyState !== 4) return value;
        try {
          return transform(this, value);
        } catch (_) {
          return value;
        }
      };
      Object.defineProperty(proto, prop, { ...desc, get: mask(get, originalGet) });
    };

    wrapGetter('responseText', (xhr, value) => (
      typeof value === 'string' && value ? cleanedText(xhr, value) : value
    ));

    wrapGetter('response', (xhr, value) => {
      if (typeof value === 'string' && value) return cleanedText(xhr, value);
      if (value && typeof value === 'object' && xhr.responseType === 'json') {
        if (targets.get(xhr) !== value) {
          cleanse(value);
          targets.set(xhr, value);
        }
      }
      return value;
    });

    restorers.push(() => {
      try { proto.open = originalOpen; } catch (_) { }
      savedGets.forEach(({ prop, desc }) => {
        try { Object.defineProperty(proto, prop, desc); } catch (_) { }
      });
    });
  };

  /* ── Resume after the opening wait ─────────────────────────── */
  /*
   * After the opening wait the player lands in paused-mode / unstarted-mode.
   * video.play() from the isolated world does not move YouTube's player state,
   * so playVideo() — the same call the play button makes — runs only for a
   * short window after a /watch navigation, and only while the video is still
   * at the start. A later pause belongs to the viewer or to Chrome's media
   * controls and is left alone.
   *
   * Shorts and Home keep #movie_player in the document. Starting it again
   * plays the previous video under the new one. Only the video that belongs
   * to the page on screen is allowed to play.
   */

  const ARM_MS = 8000;
  let viewerPaused = false;
  let kickTimer = null;
  let armUntil = 0;
  let stopPlaybackListeners = () => {};

  const pagePath = () => {
    if (location && typeof location.pathname === 'string' && location.pathname.startsWith('/')) {
      return location.pathname;
    }
    try {
      return new URL(String(location && location.href), 'https://www.youtube.com').pathname;
    } catch (_) {
      return '';
    }
  };

  const isWatch = () => {
    const path = pagePath();
    return path === '/watch' || path.startsWith('/watch/');
  };

  const isShorts = () => {
    const path = pagePath();
    return path === '/shorts' || path.startsWith('/shorts/');
  };

  const playerStalled = (player) => (
    player.classList.contains('paused-mode') || player.classList.contains('unstarted-mode')
  );

  const stopKick = () => {
    if (kickTimer) {
      clearTimeout(kickTimer);
      kickTimer = null;
    }
  };

  const kickAllowed = () => (
    !released && isWatch() && !viewerPaused && performance.now() < armUntil
  );

  const videoInActivePage = (video) => {
    if (!video || typeof video.closest !== 'function') return false;
    if (isWatch()) {
      const movie = document.getElementById('movie_player');
      return !!(movie && movie.contains(video));
    }
    if (isShorts()) return !!video.closest('#shorts-player, ytd-shorts, ytd-reel-video-renderer');
    return false;
  };

  const pausePlayer = (player) => {
    if (!player) return;
    try {
      if (typeof player.pauseVideo === 'function') player.pauseVideo();
    } catch (_) { }
    if (!player.querySelectorAll) return;
    player.querySelectorAll('video').forEach((video) => {
      if (video.paused) return;
      try { video.pause(); } catch (_) { }
    });
  };

  const pauseStrays = () => {
    if (released) return;
    const movie = document.getElementById('movie_player');
    if (!isWatch()) pausePlayer(movie);
    document.querySelectorAll('video').forEach((video) => {
      if (videoInActivePage(video) || video.paused) return;
      try { video.pause(); } catch (_) { }
    });
  };

  const playbackUnderway = (player) => {
    const video = player && player.querySelector && player.querySelector('video');
    return !!(video && video.currentTime > 1 && !video.paused);
  };

  const kickPlayback = () => {
    if (!kickAllowed()) return true;
    const player = document.getElementById('movie_player');
    if (!player) return true;
    if (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting')) return false;
    if (player.classList.contains('playing-mode') && !playerStalled(player)) return true;
    const video = player.querySelector('video');
    if (video && Number.isFinite(video.duration) && video.duration > 1 && video.currentTime >= video.duration - 0.5) {
      return true;
    }
    try {
      if (typeof player.playVideo === 'function') player.playVideo();
      else if (video && typeof video.play === 'function') video.play().catch(() => {});
    } catch (_) { }
    return false;
  };

  const scheduleKick = () => {
    if (!kickAllowed() || kickTimer) return;
    let tries = 0;
    const run = () => {
      tries += 1;
      if (kickPlayback() || tries >= 24 || !kickAllowed()) {
        kickTimer = null;
        return;
      }
      kickTimer = setTimeout(run, 300);
    };
    run();
  };

  const armKick = (force) => {
    if (!isWatch() || released) return;
    const player = document.getElementById('movie_player');
    viewerPaused = false;
    if (!force && playbackUnderway(player)) {
      armUntil = 0;
      return;
    }
    armUntil = performance.now() + ARM_MS;
    scheduleKick();
  };

  const watchPlayback = () => {
    const pageWindow = typeof window.addEventListener === 'function' ? window : globalThis;
    const attached = new WeakSet();

    const onPause = (event) => {
      if (viewerPaused || (event && event.isTrusted)) {
        armUntil = 0;
        stopKick();
        return;
      }
      if (kickAllowed()) scheduleKick();
    };

    const attach = (player) => {
      if (!player || attached.has(player)) return;
      attached.add(player);
      player.addEventListener('pause', onPause, true);
      player.addEventListener('playing', () => {
        const video = player.querySelector('video');
        if (!video || !(video.currentTime > 0.25)) return;
        const grace = performance.now() + 1500;
        if (armUntil > grace) armUntil = grace;
      }, true);
      if (isWatch()) armKick();
      else pauseStrays();
    };

    const find = () => {
      const player = document.getElementById('movie_player');
      if (!player) return false;
      attach(player);
      return true;
    };

    const onClick = (event) => {
      const player = document.getElementById('movie_player');
      if (!player || !event.target || !player.contains(event.target)) return;
      const video = player.querySelector('video');
      if (!video) return;
      viewerPaused = !video.paused;
      if (viewerPaused) {
        armUntil = 0;
        stopKick();
      }
    };

    const onKey = (event) => {
      if (event.key !== 'k' && event.key !== 'K' && event.code !== 'Space') return;
      const target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const video = document.querySelector('#movie_player video');
      if (!video) return;
      viewerPaused = !video.paused;
      if (viewerPaused) {
        armUntil = 0;
        stopKick();
      }
    };

    const onNavigate = () => {
      stopKick();
      armUntil = 0;
      viewerPaused = false;
      pauseStrays();
      if (isWatch()) armKick(true);
    };

    const onStrayPlay = (event) => {
      if (released) return;
      const video = event.target;
      if (!video || video.localName !== 'video' || videoInActivePage(video)) return;
      try { video.pause(); } catch (_) { }
      const movie = document.getElementById('movie_player');
      if (movie && movie.contains(video)) pausePlayer(movie);
      setTimeout(() => {
        if (released || video.paused || videoInActivePage(video)) return;
        try { video.pause(); } catch (_) { }
        if (movie && movie.contains(video)) pausePlayer(movie);
      }, 0);
    };

    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('play', onStrayPlay, true);
    document.addEventListener('playing', onStrayPlay, true);
    pageWindow.addEventListener('yt-navigate-finish', onNavigate);

    stopPlaybackListeners = () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('play', onStrayPlay, true);
      document.removeEventListener('playing', onStrayPlay, true);
      pageWindow.removeEventListener('yt-navigate-finish', onNavigate);
    };

    if (find()) return;
    const finder = new MutationObserver(() => {
      if (find()) finder.disconnect();
    });
    observers.push(finder);
    finder.observe(document.documentElement, { childList: true, subtree: true });
  };

  /* ── Ad-block wall ─────────────────────────────────────────── */
  /*
   * YouTube answers a detected blocker with ytd-enforcement-message-view-model
   * ("Ad blockers are not allowed") plus tp-yt-iron-overlay-backdrop.opened.
   * The backdrop is a fixed black layer at about 60% opacity, and the overlay
   * manager freezes page scroll until the dialog is closed in this realm.
   */

  const dismissAdWall = () => {
    if (released) return;
    const messages = document.querySelectorAll('ytd-enforcement-message-view-model');
    if (!messages.length) return;

    messages.forEach((node) => {
      const dialog = node.closest('tp-yt-paper-dialog') || node;
      try {
        if (typeof dialog.close === 'function') dialog.close();
      } catch (_) { }
      dialog.classList.remove('opened');
      dialog.removeAttribute('opened');
      try { dialog.remove(); } catch (_) { }
    });

    document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach((backdrop) => {
      try {
        if (typeof backdrop.close === 'function') backdrop.close();
      } catch (_) { }
      backdrop.classList.remove('opened');
      backdrop.removeAttribute('opened');
      try { backdrop.remove(); } catch (_) { }
    });

    const unlock = (el) => {
      if (!el) return;
      el.classList.remove('no-scroll', 'no-y-scroll');
      if (el.style.overflow === 'hidden') el.style.overflow = '';
      if (el.style.overflowY === 'hidden') el.style.overflowY = '';
    };
    unlock(document.documentElement);
    unlock(document.body);
    if (kickAllowed()) scheduleKick();
  };

  const nodeBringsWall = (node) => {
    if (!node || node.nodeType !== 1) return false;
    const name = node.localName;
    if (name === 'ytd-enforcement-message-view-model' || name === 'tp-yt-iron-overlay-backdrop' || name === 'tp-yt-paper-dialog') {
      return true;
    }
    return !!(node.querySelector && node.querySelector('ytd-enforcement-message-view-model'));
  };

  const watchAdWall = () => {
    let armed = false;
    const observer = new MutationObserver((records) => {
      if (!armed) {
        arm();
        return;
      }
      for (let i = 0; i < records.length; i++) {
        const added = records[i].addedNodes;
        for (let j = 0; j < added.length; j++) {
          if (nodeBringsWall(added[j])) {
            dismissAdWall();
            return;
          }
        }
      }
    });

    const arm = () => {
      const popup = document.querySelector('ytd-popup-container');
      if (!document.body || !popup) return;
      armed = true;
      observer.disconnect();
      observer.observe(popup, { childList: true, subtree: true });
      observer.observe(document.body, { childList: true });
      dismissAdWall();
    };

    observers.push(observer);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    arm();
  };

  /* ── Bootstrap ─────────────────────────────────────────────── */

  let lastBeat = performance.now();
  let onControl = () => {};

  const releaseAll = () => {
    if (released) return;
    released = true;
    mark.active = false;
    stopKick();
    armUntil = 0;
    stopPlaybackListeners();
    observers.forEach((observer) => {
      try { observer.disconnect(); } catch (_) { }
    });
    observers.length = 0;
    restorers.forEach((restore) => {
      try { restore(); } catch (_) { }
    });
    try { document.removeEventListener(CTL, onControl); } catch (_) { }
    try { delete window[MARK]; } catch (_) { }
  };

  onControl = (event) => {
    const detail = event && event.detail;
    if (detail === 'beat') {
      lastBeat = performance.now();
      return;
    }
    if (detail === 'release') releaseAll();
  };

  const keepalive = () => {
    if (released) return;
    if (performance.now() - lastBeat >= 4000) {
      releaseAll();
      return;
    }
    setTimeout(keepalive, 1500);
  };

  document.addEventListener(CTL, onControl);

  // The main world has no extension API. Tests run where chrome.runtime.id
  // exists, and must not drop the hooks on a timer.
  let extensionApi = false;
  try {
    extensionApi = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);
  } catch (_) { extensionApi = false; }
  if (!extensionApi) setTimeout(keepalive, 1500);

  patchOutbound();
  patchInitialPlayerResponse();
  patchFetch();
  patchXhr();
  watchPlayback();
  watchAdWall();
})();
