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
  var lastContentSnapshot = null;
  var pendingRestoreSnapshot = null;

  /* ── Authoritative ad check ──────────────────────────────────── */

  function playerInAdMode(player) {
    return (
      player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting')
    );
  }

  /* ── URL timestamp helper ──────────────────────────────────── */

  function getCurrentVideoId() {
    try {
      var params = new URLSearchParams(window.location.search);
      if (params.get('v')) {
        return params.get('v');
      }

      var path = window.location.pathname || '';
      if (path.indexOf('/shorts/') === 0) {
        return path.split('/shorts/')[1] || '';
      }
    } catch (_) { }

    return '';
  }

  function getUrlStartTime() {
    try {
      var params = new URLSearchParams(window.location.search);
      var t = params.get('t');
      if (!t) return null;

      if (/^\d+$/.test(t)) {
        return parseInt(t, 10);
      }

      var total = 0;
      var match = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
      if (match) {
        total += parseInt(match[1] || '0', 10) * 3600;
        total += parseInt(match[2] || '0', 10) * 60;
        total += parseInt(match[3] || '0', 10);
      }

      return total > 0 ? total : null;
    } catch (_) { }

    return null;
  }

  function getVideoIdentityKey(video) {
    return [
      getCurrentVideoId(),
      (video && (video.currentSrc || video.src)) || ''
    ].join('|');
  }

  function captureContentSnapshot(video) {
    if (!video) return null;

    var currentTime = Number(video.currentTime) || 0;
    var urlStartTime = getUrlStartTime();
    var targetTime = currentTime > 0.25 ? currentTime : urlStartTime;

    if (!targetTime || targetTime < 0) {
      return null;
    }

    return {
      identity: getVideoIdentityKey(video),
      targetTime: targetTime,
      wasPaused: video.paused,
      capturedAt: Date.now()
    };
  }

  function refreshContentSnapshot(video) {
    if (!video || playerInAdMode(document.querySelector('#movie_player') || document.createElement('div'))) {
      return;
    }

    var snapshot = captureContentSnapshot(video);
    if (!snapshot) return;

    if (!lastContentSnapshot || snapshot.targetTime >= lastContentSnapshot.targetTime - 0.25) {
      lastContentSnapshot = snapshot;
    }
  }

  function maybeRestoreContentPosition(player, video) {
    if (!video || !pendingRestoreSnapshot || playerInAdMode(player)) {
      return false;
    }

    var snapshot = pendingRestoreSnapshot;
    var age = Date.now() - snapshot.capturedAt;
    if (age > 10000) {
      pendingRestoreSnapshot = null;
      return false;
    }

    var currentIdentity = getVideoIdentityKey(video);
    if (snapshot.identity && currentIdentity && snapshot.identity !== currentIdentity) {
      pendingRestoreSnapshot = null;
      return false;
    }

    var targetTime = snapshot.targetTime;
    if (!targetTime || targetTime < 0.25) {
      pendingRestoreSnapshot = null;
      return false;
    }

    var drift = Math.abs(video.currentTime - targetTime);
    if (drift > 1.5 && (video.currentTime < targetTime || video.currentTime > targetTime + 30)) {
      try {
        video.currentTime = targetTime;
      } catch (_) { }
    }

    if (!snapshot.wasPaused && video.paused && video.readyState >= 2) {
      video.play().catch(function () { });
    }

    pendingRestoreSnapshot = null;
    return true;
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

    document.querySelectorAll(MODAL_BACKDROP_SEL).forEach(function (el) {
      try { el.removeAttribute('opened'); } catch (_) {}
      try { el.classList.remove('opened'); } catch (_) {}
      try { el.style.setProperty('display', 'none', 'important'); } catch (_) {}
      try { el.style.setProperty('pointer-events', 'none', 'important'); } catch (_) {}
      try { el.remove(); } catch (_) {}
    });

    if (document.body) {
      try { document.body.style.removeProperty('overflow'); } catch (_) {}
      try { document.body.style.removeProperty('pointer-events'); } catch (_) {}
    }
    try { document.documentElement.style.removeProperty('overflow'); } catch (_) {}
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
      pendingRestoreSnapshot = lastContentSnapshot;
      if (!pendingRestoreSnapshot) {
        var urlStartTime = getUrlStartTime();
        if (urlStartTime) {
          pendingRestoreSnapshot = {
            identity: '',
            targetTime: urlStartTime,
            wasPaused: false,
            capturedAt: Date.now()
          };
        }
      }

      var restoreIfNeeded = function () {
        if (Date.now() - adEndTimestamp > 5000) {
          cleanup();
          return;
        }

        if (maybeRestoreContentPosition(player, video)) {
          cleanup();
        }
      };

      var cleanup = function () {
        video.removeEventListener('playing', restoreIfNeeded, true);
        video.removeEventListener('loadeddata', restoreIfNeeded, true);
        video.removeEventListener('timeupdate', restoreIfNeeded, true);
        wasInAdMode = false;
      };

      video.addEventListener('playing', restoreIfNeeded, true);
      video.addEventListener('loadeddata', restoreIfNeeded, true);
      video.addEventListener('timeupdate', restoreIfNeeded, true);

      // Autoplay: the ad-skip sequence often leaves the real video paused.
      // Wait briefly for the real video to load, then trigger play.
      var ensurePlay = function () {
        if (playerInAdMode(player)) return;
        if (video.paused && video.readyState >= 2) {
          video.play().catch(function () {});
        }
      };
      setTimeout(ensurePlay, 100);
      setTimeout(ensurePlay, 300);
      setTimeout(ensurePlay, 800);
      setTimeout(restoreIfNeeded, 150);
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
        maybeRestoreContentPosition(player, video);
        refreshContentSnapshot(video);
        // Ensure autoplay after ad skip
        if (video.paused && video.readyState >= 2) {
          video.play().catch(function () {});
        }
      }
    }, true);

    video.addEventListener('playing', function () {
      if (!playerInAdMode(player) && video.playbackRate !== 1) {
        video.playbackRate = 1;
      }
      maybeRestoreContentPosition(player, video);
      refreshContentSnapshot(video);
    }, true);

    video.addEventListener('timeupdate', function () {
      if (!playerInAdMode(player)) {
        refreshContentSnapshot(video);
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
      pendingRestoreSnapshot = null;
      lastContentSnapshot = null;
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
      var player = document.querySelector('#movie_player');
      if (player) {
        onPlayerStateChange(player);
        if (!playerInAdMode(player)) {
          refreshContentSnapshot(player.querySelector('video'));
        }
      }
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

  function bootstrapAdBlocker() {
    injectEarlyStyle();
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
