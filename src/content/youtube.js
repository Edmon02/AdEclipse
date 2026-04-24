/**
 * AdEclipse - YouTube Content Script  (ISOLATED world)
 *
 * Eliminates YouTube video ads at the DOM / player-API level.
 * Works alongside:
 *   youtube-mainworld.js  – strips ad payloads from API responses (MAIN world)
 *   youtube.css            – instant visual hiding via pure CSS
 *
 * Design rules
 * ────────────
 * 1.  The ONLY signal for "ad is playing" is YouTube's own `ad-showing` /
 *     `ad-interrupting` class on `#movie_player`.
 * 2.  While that class is present we:  mute → seek ad to end → click skip.
 * 3.  We NEVER change video.playbackRate.  Setting 16× caused the real video
 *     to silently fast-forward ~1 min before the class was removed.
 * 4.  The moment the class is removed we restore audio and stop all actions.
 *     We never touch currentTime on the real video.
 * 5.  CSS hides <video> + spinner while ad-showing is present, so the user
 *     sees a brief blank – never ad frames.
 * 6.  Once the ad has been seeked to end, we stop issuing further seeks to
 *     prevent accidentally seeking the real video during source transition.
 * 7.  After ad mode ends, we reset currentTime if it's suspiciously high
 *     (fixes the ~1:07 skip bug).
 */
(function () {
  'use strict';

  if (window.__ADECLIPSE_YT_LOADED__) return;
  window.__ADECLIPSE_YT_LOADED__ = true;

  var ytUtils = window.__ADECLIPSE_YT_UTILS__ || {};

  /* ── Enabled gate ──────────────────────────────────────────── */
  /* Ask the background whether the extension is enabled for this  *
   * site.  If disabled (global OFF or site-whitelisted) we bail   *
   * out completely – no styles, no observers, no ad skipping.     */

  var extensionEnabled = true; // optimistic default; corrected below

  function checkEnabledAndBoot() {
    try {
      chrome.runtime.sendMessage({ type: 'GET_SITE_ENABLED' }, function (res) {
        if (chrome.runtime.lastError || !res) {
          // Extension context gone – do nothing
          return;
        }
        extensionEnabled = res.enabled;
        if (!extensionEnabled) {
          // Remove any styles we may have already injected
          var earlyStyle = document.getElementById('adeclipse-yt-early');
          if (earlyStyle) earlyStyle.remove();
          return; // stop – don't attach any observers or loops
        }
        // Enabled → proceed with full bootstrap
        bootstrapAdBlocker();
      });
    } catch (_) {
      // If messaging fails, assume disabled to be safe
    }
  }

  /* ── Selector constants ──────────────────────────────────────── */

  var SKIP_BTN_SEL =
    '.ytp-skip-ad-button,' +
    '.ytp-ad-skip-button,' +
    '.ytp-ad-skip-button-modern,' +
    '.ytp-ad-skip-button-container button,' +
    '.ytp-ad-skip-button-slot button,' +
    '.videoAdUiSkipButton,' +
    'button[class*="ytp-ad-skip"]';

  var AD_OVERLAY_SEL =
    '.video-ads,' +
    '.ytp-ad-module,' +
    '.ytp-ad-overlay-container,' +
    '.ytp-ad-text-overlay,' +
    '.ytp-ad-image-overlay,' +
    '.ytp-ad-player-overlay,' +
    '.ytp-ad-player-overlay-layout,' +
    '.ytp-ad-action-interstitial-slot,' +
    '.ytp-ad-action-interstitial-background-container,' +
    '.ytp-ad-progress-list,' +
    '.ytp-ad-preview-container,' +
    '.ytp-ad-preview-text,' +
    '.ytp-ad-simple-ad-badge,' +
    '.ytp-ad-persistent-progress-bar-container,' +
    '.ytp-ad-player-overlay-instream-info,' +
    '.ytp-ad-player-overlay-skip-or-preview,' +
    '.ytp-ad-visit-advertiser-button,' +
    '.ad-simple-attributed-string,' +
    '.ytp-ad-badge__text--clean-player,' +
    '#player-ads,' +
    '#player-overlay\\:0,' +
    '#player-overlay-layout\\:0';

  var STATIC_AD_SEL =
    '#masthead-ad,' +
    'ytd-display-ad-renderer,' +
    'ytd-ad-slot-renderer,' +
    'ytd-promoted-sparkles-web-renderer,' +
    'ytd-compact-promoted-video-renderer,' +
    'ytd-merch-shelf-renderer,' +
    'ytd-in-feed-ad-layout-renderer,' +
    'ytd-banner-promo-renderer,' +
    'ytd-video-masthead-ad-v3-renderer,' +
    'ytd-primetime-promo-renderer,' +
    'ytd-player-legacy-desktop-watch-ads-renderer,' +
    'ytd-rich-item-renderer:has(ytd-ad-slot-renderer),' +
    'ytd-rich-section-renderer:has(ytd-ad-slot-renderer)';

  var BLOCKED_DIALOG_SEL =
    'tp-yt-paper-dialog:has(.ytd-enforcement-message-view-model),' +
    'tp-yt-paper-dialog:has([class*="premium"]),' +
    '.ytd-popup-container:has([class*="premium"]),' +
    'ytd-enforcement-message-view-model';

  var MODAL_BACKDROP_SEL =
    'tp-yt-iron-overlay-backdrop,' +
    'tp-yt-iron-overlay-backdrop.opened,' +
    'tp-yt-iron-overlay-backdrop[opened]';

  /* ── Persistent state ────────────────────────────────────────── */

  var adHandling    = false;
  var adLoopId      = null;
  var adIntervalId  = null;
  var savedMuted    = false;
  var savedVolume   = 1;
  var adSeekedToEnd = false;
  var adEndTimestamp = 0;
  var wasInAdMode   = false;
  var realVideoStartTime = 0;  // Track where the real video started
  var postAdRecoveryToken = 0;

  /* ── Authoritative ad check ──────────────────────────────────── */

  function playerInAdMode(player) {
    return (
      player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting')
    );
  }

  /* ── URL timestamp helper ──────────────────────────────────── */

  function getUrlStartTime() {
    try {
      var params = new URLSearchParams(window.location.search);
      var t = params.get('t');
      if (t) {
        // Handle formats: "120", "120s", "2m", "1h2m3s"
        var match = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
        if (match) {
          var h = parseInt(match[1] || '0', 10);
          var m = parseInt(match[2] || '0', 10);
          var s = parseInt(match[3] || '0', 10);
          return h * 3600 + m * 60 + s;
        }
      }
    } catch (_) {}
    return 0;
  }

  function getResumeTargetTime(player, video) {
    var candidates = [];

    if (video && Number.isFinite(video.currentTime)) {
      candidates.push(video.currentTime);
    }

    if (player && typeof player.getCurrentTime === 'function') {
      try {
        candidates.push(player.getCurrentTime());
      } catch (_) {}
    }

    candidates.push(getUrlStartTime());

    if (typeof ytUtils.getResumeTargetTime === 'function') {
      return ytUtils.getResumeTargetTime(candidates);
    }

    return candidates.reduce(function (best, candidate) {
      return Number.isFinite(candidate) && candidate > best ? candidate : best;
    }, 0);
  }

  function clampPlaybackTarget(targetTime, duration) {
    if (typeof ytUtils.clampPlaybackTarget === 'function') {
      return ytUtils.clampPlaybackTarget(targetTime, duration);
    }

    if (!Number.isFinite(targetTime) || targetTime < 0) return 0;
    if (Number.isFinite(duration) && duration > 1) {
      return Math.min(targetTime, Math.max(duration - 0.25, 0));
    }
    return targetTime;
  }

  function shouldRestorePlaybackPosition(targetTime, currentTime, duration) {
    if (typeof ytUtils.shouldRestorePlaybackPosition === 'function') {
      return ytUtils.shouldRestorePlaybackPosition(targetTime, currentTime, duration);
    }

    if (!Number.isFinite(currentTime) || currentTime < 0) return false;
    var safeTarget = clampPlaybackTarget(targetTime, duration);
    if (safeTarget < 1) return false;
    if (Math.abs(currentTime - safeTarget) <= 1.5) return false;
    return currentTime <= Math.min(3, safeTarget * 0.25) || currentTime > safeTarget + 15;
  }

  function ensurePlayback(player, video) {
    if (!video || playerInAdMode(player)) return;
    if (!video.paused || video.readyState < 2) return;

    try {
      var playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(function () {
          var playBtn = player.querySelector('.ytp-play-button, button[aria-label="Play"]');
          if (playBtn) {
            try { playBtn.click(); } catch (_) {}
          }
        });
      }
    } catch (_) {}
  }

  function queuePostAdRecovery(player, video) {
    var recoveryToken = ++postAdRecoveryToken;
    var restoreTargetTime = getResumeTargetTime(player, video);
    var attemptDelays = [0, 120, 350, 800, 1400];

    attemptDelays.forEach(function (delay, index) {
      setTimeout(function () {
        if (postAdRecoveryToken !== recoveryToken) return;
        if (!video || playerInAdMode(player)) return;

        if (video.playbackRate !== 1) {
          video.playbackRate = 1;
        }

        if (shouldRestorePlaybackPosition(restoreTargetTime, video.currentTime, video.duration)) {
          try {
            video.currentTime = clampPlaybackTarget(restoreTargetTime, video.duration);
          } catch (_) {}
        }

        ensurePlayback(player, video);

        if (index === attemptDelays.length - 1) {
          wasInAdMode = false;
        }
      }, delay);
    });
  }

  /* ── Micro-actions ───────────────────────────────────────────── */

  function clickSkipButtons() {
    document.querySelectorAll(SKIP_BTN_SEL).forEach(function (b) {
      try { b.click(); } catch (_) {}
    });
  }

  function hideAdOverlays() {
    document.querySelectorAll(AD_OVERLAY_SEL).forEach(function (el) {
      el.style.setProperty('display', 'none', 'important');
    });
  }

  function purgeStaticAds() {
    document.querySelectorAll(STATIC_AD_SEL).forEach(function (el) {
      el.remove();
    });
  }

  function purgeBlockedYoutubePopups() {
    var hasBlockedDialog = false;

    document.querySelectorAll(BLOCKED_DIALOG_SEL).forEach(function (el) {
      hasBlockedDialog = true;

      var dialog = el.closest('tp-yt-paper-dialog') || el;
      var popupContainer = el.closest('.ytd-popup-container');

      [dialog, popupContainer].forEach(function (node) {
        if (!node) return;
        try {
          if (typeof node.cancel === 'function') node.cancel();
        } catch (_) {}
        try {
          if (typeof node.close === 'function') node.close();
        } catch (_) {}
        try { node.removeAttribute('opened'); } catch (_) {}
        try { node.classList.remove('opened'); } catch (_) {}
        try { node.style.setProperty('display', 'none', 'important'); } catch (_) {}
      });
    });

    if (!hasBlockedDialog) return;

    // Aggressively remove all modal backdrops
    document.querySelectorAll(MODAL_BACKDROP_SEL).forEach(function (el) {
      try { el.removeAttribute('opened'); } catch (_) {}
      try { el.classList.remove('opened'); } catch (_) {}
      try { el.style.setProperty('display', 'none', 'important'); } catch (_) {}
      try { el.style.setProperty('pointer-events', 'none', 'important'); } catch (_) {}
      try { el.style.setProperty('visibility', 'hidden', 'important'); } catch (_) {}
      try { el.style.setProperty('opacity', '0', 'important'); } catch (_) {}
      try { el.remove(); } catch (_) {}
    });

    // Unlock scrolling on html and body - use multiple approaches
    if (document.body) {
      try { document.body.style.setProperty('overflow', 'visible', 'important'); } catch (_) {}
      try { document.body.style.setProperty('pointer-events', 'auto', 'important'); } catch (_) {}
      try { document.body.style.setProperty('max-height', 'none', 'important'); } catch (_) {}
      try { document.body.style.setProperty('max-width', 'none', 'important'); } catch (_) {}
    }
    try { document.documentElement.style.setProperty('overflow', 'auto', 'important'); } catch (_) {}
    try { document.documentElement.style.setProperty('pointer-events', 'auto', 'important'); } catch (_) {}
    try { document.documentElement.style.setProperty('max-height', 'none', 'important'); } catch (_) {}
  }

  /* ── Core: nuke one frame of ad ──────────────────────────────── */

  function nukeAdFrame(player) {
    var video = player.querySelector('video');
    if (!video) return;

    // 1. Mute – user never hears the ad
    video.muted = true;

    // 2. Seek ad video to its end so YouTube advances to next content.
    //    Guard: only seek videos shorter than 5 minutes (ads are always short).
    //    Once we've seeked to end, stop issuing further seeks to prevent
    //    accidentally seeking the real video during the source transition.
    if (!adSeekedToEnd) {
      var dur = video.duration;
      if (Number.isFinite(dur) && dur > 0 && dur < 300 && video.currentTime < dur - 0.01) {
        video.currentTime = dur;
      }

      // Check if we've reached the end — fire ended event and stop seeking
      if (Number.isFinite(dur) && dur > 0 && video.currentTime >= dur - 0.5) {
        adSeekedToEnd = true;
        try { video.dispatchEvent(new Event('ended')); } catch (_) {}
      }
    }

    // 3. Click all visible skip buttons
    clickSkipButtons();

    // 4. Hide leftover overlay elements
    hideAdOverlays();
    purgeBlockedYoutubePopups();
  }

  /* ── Ad-loop management ──────────────────────────────────────── */

  function beginAdLoop(player) {
    if (adLoopId !== null || adIntervalId !== null) return;

    var step = function () {
      if (!playerInAdMode(player)) {
        endAdLoop(player);
        return;
      }
      nukeAdFrame(player);
    };

    // setInterval at 16ms for reliable firing even when CSS hides the video
    // (rAF may be throttled when video has visibility:hidden)
    adIntervalId = setInterval(function () {
      step();
    }, 16);

    // Also keep rAF as secondary mechanism for when the tab is active
    var rAfStep = function () {
      if (!playerInAdMode(player)) return;
      nukeAdFrame(player);
      adLoopId = requestAnimationFrame(rAfStep);
    };
    adLoopId = requestAnimationFrame(rAfStep);
  }

  function endAdLoop(player) {
    if (adLoopId !== null) {
      cancelAnimationFrame(adLoopId);
      adLoopId = null;
    }
    if (adIntervalId !== null) {
      clearInterval(adIntervalId);
      adIntervalId = null;
    }

    wasInAdMode = true;
    adEndTimestamp = Date.now();

    var video = player.querySelector('video');
    if (video) {
      video.muted       = savedMuted;
      video.volume       = savedVolume;
      video.playbackRate = 1;   // safety: ensure normal speed
      queuePostAdRecovery(player, video);
    } else {
      wasInAdMode = false;
    }

    adHandling = false;
  }

  /* ── State-change dispatcher ─────────────────────────────────── */

  function onPlayerStateChange(player) {
    if (playerInAdMode(player)) {
      if (!adHandling) {
        adHandling = true;
        adSeekedToEnd = false;

        // Snapshot audio state BEFORE we mute
        var video = player.querySelector('video');
        if (video) {
          savedMuted  = video.muted;
          savedVolume = video.volume;
          realVideoStartTime = getResumeTargetTime(player, video);
          postAdRecoveryToken += 1;

          // One-shot listener: seek as soon as duration is known
          var onMeta = function () {
            video.removeEventListener('loadedmetadata', onMeta, true);
            if (playerInAdMode(player) && !adSeekedToEnd) {
              var dur = video.duration;
              if (Number.isFinite(dur) && dur > 0 && dur < 300) {
                video.currentTime = dur;
              }
            }
          };
          video.addEventListener('loadedmetadata', onMeta, true);
        }
      }

      // Immediate first attempt (don't wait for rAF/interval)
      nukeAdFrame(player);
      beginAdLoop(player);
    } else if (adHandling) {
      endAdLoop(player);
    }
  }

  /* ── Safety: reset playbackRate on any new video load ────────── */

  function attachVideoSafety() {
    var player = document.querySelector('#movie_player');
    if (!player) {
      setTimeout(attachVideoSafety, 200);
      return;
    }

    var video = player.querySelector('video');
    if (!video) {
      setTimeout(attachVideoSafety, 200);
      return;
    }

    video.addEventListener('loadeddata', function () {
      if (!playerInAdMode(player)) {
        if (video.playbackRate !== 1) {
          video.playbackRate = 1;
        }
        if (wasInAdMode || Date.now() - adEndTimestamp < 5000) {
          ensurePlayback(player, video);
        }
      }
    }, true);

    video.addEventListener('playing', function () {
      if (!playerInAdMode(player) && video.playbackRate !== 1) {
        video.playbackRate = 1;
      }
    }, true);
  }

  /* ── Observers & hooks ───────────────────────────────────────── */

  function attachPlayerObserver() {
    var player = document.querySelector('#movie_player');
    if (!player) {
      setTimeout(attachPlayerObserver, 50);
      return;
    }

    onPlayerStateChange(player);

    new MutationObserver(function () {
      onPlayerStateChange(player);
    }).observe(player, { attributes: true, attributeFilter: ['class'] });
  }

  function attachBodyObserver() {
    if (!document.body) {
      requestAnimationFrame(attachBodyObserver);
      return;
    }

    var pending = false;
    new MutationObserver(function () {
      if (pending) return;
      pending = true;
      queueMicrotask(function () {
        purgeStaticAds();
        purgeBlockedYoutubePopups();
        pending = false;
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  function attachNavigationHooks() {
    var handler = function () {
      purgeStaticAds();
      purgeBlockedYoutubePopups();
      var player = document.querySelector('#movie_player');
      if (player) onPlayerStateChange(player);
    };

    window.addEventListener('yt-navigate-finish', handler, true);
    window.addEventListener('popstate', handler, true);
  }

  function startSafetyPoll() {
    setInterval(function () {
      purgeStaticAds();
      purgeBlockedYoutubePopups();

      // Ensure scrolling is always enabled (prevent YouTube from re-locking it)
      try {
        if (document.body && document.body.style.getPropertyValue('overflow') === 'hidden') {
          document.body.style.setProperty('overflow', 'auto', 'important');
          document.body.style.setProperty('pointer-events', 'auto', 'important');
        }
        if (document.documentElement && document.documentElement.style.getPropertyValue('overflow') === 'hidden') {
          document.documentElement.style.setProperty('overflow', 'auto', 'important');
          document.documentElement.style.setProperty('pointer-events', 'auto', 'important');
        }
      } catch (_) {}

      var player = document.querySelector('#movie_player');
      if (player) onPlayerStateChange(player);
    }, 500);
  }

  /* ── Early inline style (complements youtube.css) ────────────── */

  function injectEarlyStyle() {
    var s = document.createElement('style');
    s.id = 'adeclipse-yt-early';
    s.textContent =
      '#movie_player.ad-showing video,' +
      '#movie_player.ad-interrupting video' +
      '{visibility:hidden!important}' +

      '#movie_player.ad-showing .ytp-spinner,' +
      '#movie_player.ad-showing .ytp-spinner-container,' +
      '#movie_player.ad-interrupting .ytp-spinner,' +
      '#movie_player.ad-interrupting .ytp-spinner-container' +
      '{display:none!important}' +

      /* CRITICAL: Force scrolling enabled globally and permanently */
      'html {' +
        'overflow:auto!important;' +
        'overflow-y:scroll!important;' +
        'height:auto!important;' +
        'pointer-events:auto!important;' +
      '}' +
      'body {' +
        'overflow:visible!important;' +
        'overflow-y:scroll!important;' +
        'height:auto!important;' +
        'max-height:none!important;' +
        'pointer-events:auto!important;' +
        'position:static!important;' +
      '}' +
      'ytd-rich-grid-renderer {overflow:visible!important}' +

      AD_OVERLAY_SEL + '{display:none!important}';

    (document.head || document.documentElement).appendChild(s);
  }

  /* ── Aggressive scroll position override ────────────────────────────── */

  function installAggressiveScrollUnlocker() {
    var scrollMonitoringActive = true;
    var protectedScrollY = 0;
    var lastObservedScrollY = 0;
    var userScrollDirection = 0;
    var userScrollSessionUntil = 0;
    var isRestoringScroll = false;
    var originalScrollTo = window.scrollTo ? window.scrollTo.bind(window) : function () {};
    var originalScroll = window.scroll ? window.scroll.bind(window) : originalScrollTo;

    function getCurrentScrollY() {
      return window.pageYOffset || document.documentElement.scrollTop || (document.body && document.body.scrollTop) || 0;
    }

    function getScrollTargetY(argsLike) {
      if (typeof ytUtils.extractScrollTargetY === 'function') {
        return ytUtils.extractScrollTargetY(argsLike);
      }
      if (!argsLike || argsLike.length === 0) return null;
      if (argsLike[0] && typeof argsLike[0] === 'object') {
        return Number.isFinite(argsLike[0].top) ? argsLike[0].top : null;
      }
      return Number.isFinite(argsLike[1]) ? argsLike[1] : null;
    }

    function getScrollDirection(previousY, nextY) {
      if (typeof ytUtils.getScrollDirectionFromPositions === 'function') {
        return ytUtils.getScrollDirectionFromPositions(previousY, nextY);
      }
      if (nextY > previousY + 2) return 1;
      if (nextY < previousY - 2) return -1;
      return 0;
    }

    function shouldBlockProgrammaticScroll(targetY) {
      if (typeof ytUtils.shouldBlockProgrammaticScroll === 'function') {
        return ytUtils.shouldBlockProgrammaticScroll(
          targetY,
          protectedScrollY,
          userScrollDirection,
          userScrollSessionUntil,
          Date.now()
        );
      }

      if (!Number.isFinite(targetY) || !userScrollDirection || Date.now() > userScrollSessionUntil) {
        return false;
      }

      return userScrollDirection > 0 ? targetY < protectedScrollY - 120 : targetY > protectedScrollY + 120;
    }

    function shouldRecoverScrollPosition(currentY) {
      if (typeof ytUtils.shouldRecoverScrollPosition === 'function') {
        return ytUtils.shouldRecoverScrollPosition(
          currentY,
          protectedScrollY,
          userScrollDirection,
          userScrollSessionUntil,
          Date.now()
        );
      }

      if (!Number.isFinite(currentY) || !userScrollDirection || Date.now() > userScrollSessionUntil) {
        return false;
      }

      return userScrollDirection > 0 ? currentY < protectedScrollY - 140 : currentY > protectedScrollY + 140;
    }

    function markUserScroll(direction) {
      userScrollSessionUntil = Date.now() + 1500;
      if (direction) {
        userScrollDirection = direction;
      }
    }

    function trackObservedScroll() {
      if (isRestoringScroll) return;

      var currentScrollY = getCurrentScrollY();
      var derivedDirection = getScrollDirection(lastObservedScrollY, currentScrollY);

      if (derivedDirection) {
        userScrollDirection = derivedDirection;
      }

      if (Date.now() <= userScrollSessionUntil) {
        protectedScrollY = currentScrollY;
      }

      lastObservedScrollY = currentScrollY;
    }

    protectedScrollY = getCurrentScrollY();
    lastObservedScrollY = protectedScrollY;

    window.scrollTo = function () {
      var targetY = getScrollTargetY(arguments);
      if (!isRestoringScroll && shouldBlockProgrammaticScroll(targetY)) {
        return;
      }
      return originalScrollTo.apply(window, arguments);
    };

    window.scroll = function () {
      var targetY = getScrollTargetY(arguments);
      if (!isRestoringScroll && shouldBlockProgrammaticScroll(targetY)) {
        return;
      }
      return originalScroll.apply(window, arguments);
    };

    var scrollMonitor = setInterval(function () {
      if (!scrollMonitoringActive || isRestoringScroll) return;

      try {
        var currentScrollY = getCurrentScrollY();
        if (shouldRecoverScrollPosition(currentScrollY)) {
          isRestoringScroll = true;
          originalScrollTo(0, protectedScrollY);
          lastObservedScrollY = protectedScrollY;
          setTimeout(function () {
            isRestoringScroll = false;
          }, 80);
          return;
        }

        trackObservedScroll();
      } catch (_) {}
    }, 80);

    var onScroll = function () {
      trackObservedScroll();
    };

    var onWheel = function (e) {
      if (Math.abs(e.deltaY) < 1) return;
      markUserScroll(e.deltaY > 0 ? 1 : -1);
    };

    var onKeyDown = function (e) {
      var direction = 0;

      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ' || e.key === 'End') {
        direction = 1;
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Home') {
        direction = -1;
      }

      if (direction) {
        markUserScroll(direction);
      }
    };

    var onPointerDown = function () {
      markUserScroll(0);
    };

    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    document.addEventListener('wheel', onWheel, { capture: true, passive: true });
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('touchstart', onPointerDown, { capture: true, passive: true });
    document.addEventListener('touchmove', onPointerDown, { capture: true, passive: true });

    // 5. Prevent scroll-related CSS from locking
    var styleMonitor = setInterval(function () {
      try {
        ['html', 'body'].forEach(function (selector) {
          var el = selector === 'html' ? document.documentElement : document.body;
          if (!el) return;

          // Remove height locks
          if (el.style.height === '100%' || el.style.height === '100vh') {
            el.style.setProperty('height', 'auto', 'important');
          }
          if (el.style.maxHeight && el.style.maxHeight !== 'none') {
            el.style.setProperty('max-height', 'none', 'important');
          }

          // Remove overflow locks
          if (el.style.overflow === 'hidden') {
            el.style.setProperty('overflow', selector === 'html' ? 'auto' : 'visible', 'important');
          }

          // Restore pointer events
          if (el.style.pointerEvents === 'none') {
            el.style.setProperty('pointer-events', 'auto', 'important');
          }
        });
      } catch (_) {}
    }, 200);

    // 6. Force enable scrolling at CSS level permanently
    var styleSheet = document.createElement('style');
    styleSheet.id = 'adeclipse-scroll-override';
    styleSheet.textContent =
      'html { overflow-y: auto !important; width: 100% !important; height: auto !important; }' +
      'body { overflow: visible !important; overflow-y: auto !important; width: 100% !important; height: auto !important; position: static !important; }' +
      /* Block any element trying to prevent scrolling */
      '[style*="overflow"][style*="hidden"] { overflow: visible !important; }' +
      '[style*="position"][style*="fixed"] > * { position: relative !important; }';

    (document.head || document.documentElement).appendChild(styleSheet);

    // 7. Monitor modal backdrops in real-time and kill them
    var backdropKiller = setInterval(function () {
      try {
        document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach(function (backdrop) {
          if (backdrop.style.display !== 'none') {
            backdrop.style.setProperty('display', 'none', 'important');
            backdrop.style.setProperty('pointer-events', 'none', 'important');
            backdrop.style.setProperty('visibility', 'hidden', 'important');
          }
        });
      } catch (_) {}
    }, 150);

    // Cleanup function if needed
    return function cleanup() {
      scrollMonitoringActive = false;
      clearInterval(scrollMonitor);
      clearInterval(styleMonitor);
      clearInterval(backdropKiller);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('wheel', onWheel, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('mousedown', onPointerDown, true);
    };
  }

  /* ── Bootstrap ───────────────────────────────────────────────── */

  function bootstrapAdBlocker() {
    injectEarlyStyle();
    installAggressiveScrollUnlocker();
    purgeStaticAds();
    purgeBlockedYoutubePopups();
    attachPlayerObserver();
    attachVideoSafety();
    attachBodyObserver();
    attachNavigationHooks();
    startSafetyPoll();
  }

  // Gate everything behind the enabled check
  checkEnabledAndBoot();
})();
