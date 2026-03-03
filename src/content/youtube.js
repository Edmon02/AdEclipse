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

  /* ── Persistent state ────────────────────────────────────────── */

  var adHandling    = false;
  var adLoopId      = null;
  var adIntervalId  = null;
  var savedMuted    = false;
  var savedVolume   = 1;
  var adSeekedToEnd = false;
  var adEndTimestamp = 0;
  var wasInAdMode   = false;

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

      // Register one-shot listeners to reset currentTime if the real video
      // inherited a wrong position from the ad-skip seeks
      var resetDone = false;
      var resetIfNeeded = function () {
        if (resetDone) return;

        // Only act within 5 seconds of ad ending
        if (Date.now() - adEndTimestamp > 5000) {
          cleanup();
          return;
        }

        // If not in ad mode and currentTime is suspiciously high
        if (!playerInAdMode(player) && video.currentTime > 2) {
          var targetTime = getUrlStartTime();
          video.currentTime = targetTime;
          resetDone = true;
          cleanup();
        }
      };

      var cleanup = function () {
        video.removeEventListener('playing', resetIfNeeded, true);
        video.removeEventListener('loadeddata', resetIfNeeded, true);
        video.removeEventListener('timeupdate', resetIfNeeded, true);
        wasInAdMode = false;
      };

      video.addEventListener('playing', resetIfNeeded, true);
      video.addEventListener('loadeddata', resetIfNeeded, true);
      video.addEventListener('timeupdate', resetIfNeeded, true);
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
        // Post-ad reset: if we recently exited ad mode and time is wrong
        if (wasInAdMode && video.currentTime > 2) {
          var targetTime = getUrlStartTime();
          video.currentTime = targetTime;
          wasInAdMode = false;
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
        pending = false;
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  function attachNavigationHooks() {
    var handler = function () {
      purgeStaticAds();
      var player = document.querySelector('#movie_player');
      if (player) onPlayerStateChange(player);
    };

    window.addEventListener('yt-navigate-finish', handler, true);
    window.addEventListener('popstate', handler, true);
  }

  function startSafetyPoll() {
    setInterval(function () {
      purgeStaticAds();
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

      AD_OVERLAY_SEL + '{display:none!important}';

    (document.head || document.documentElement).appendChild(s);
  }

  /* ── Bootstrap ───────────────────────────────────────────────── */

  injectEarlyStyle();
  purgeStaticAds();
  attachPlayerObserver();
  attachVideoSafety();
  attachBodyObserver();
  attachNavigationHooks();
  startSafetyPoll();
})();
