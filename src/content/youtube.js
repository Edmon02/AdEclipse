/**
 * AdEclipse - YouTube Content Script  (ISOLATED world)
 *
 * Fallback for ads that survive the main-world payload cleanse.
 * Works alongside:
 *   youtube-mainworld.js  – strips ad pods from player responses (MAIN world)
 *   youtube.css            – hides ad UI, feed ads, and ad frames
 *
 * Design rules
 * ────────────
 * 1.  The ONLY signal for "ad is playing" is YouTube's own `ad-showing` /
 *     `ad-interrupting` class on `#movie_player`.
 * 2.  While that class is present we mute, seek each ad to its end once its
 *     duration is known, and click the skip button. Driven by media events,
 *     never by timers.
 * 3.  We NEVER change video.playbackRate.  Setting 16× caused the real video
 *     to silently fast-forward ~1 min before the class was removed.
 * 4.  The moment the class is removed we restore audio, and put the real
 *     video back where it was if the ad seek moved it.
 * 5.  No page-visible globals, DOM ids, or polling. Idle cost is one
 *     MutationObserver, plus a slow signal so a removed extension lets go.
 */
(function () {
  'use strict';

  var CTL = 'yt-player-ctl';
  if (window.ytPlayerCtl && window.ytPlayerCtl.active) return;
  var ctlState = { active: true };
  try {
    Object.defineProperty(window, 'ytPlayerCtl', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: ctlState
    });
  } catch (e) {}

  var stopped = false;
  var beatTimer = null;

  var SKIP_BTN_SEL =
    '.ytp-skip-ad-button,' +
    '.ytp-ad-skip-button,' +
    '.ytp-ad-skip-button-modern,' +
    '.ytp-ad-skip-button-container button,' +
    '.ytp-ad-skip-button-slot button,' +
    '.videoAdUiSkipButton,' +
    'button[class*="ytp-ad-skip"]';

  var ENFORCEMENT_SEL = 'ytd-enforcement-message-view-model';

  var MAX_AD_DURATION = 300;
  var RESTORE_WINDOW_MS = 5000;

  /* ── State ───────────────────────────────────────────────────── */

  var player = null;
  var popupContainer = null;
  var adVideo = null;
  var inAd = false;
  var savedMuted = false;
  var savedVolume = 1;
  var realVideoStartTime = 0;

  function playerInAdMode(p) {
    return p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting');
  }

  function clickSkipButton() {
    var btn = player && player.querySelector(SKIP_BTN_SEL);
    if (btn) {
      try { btn.click(); } catch (_) {}
    }
  }

  /* ── Ad handling ─────────────────────────────────────────────── */

  function seekAdToEnd() {
    if (!inAd || !adVideo) return;
    var dur = adVideo.duration;
    if (Number.isFinite(dur) && dur > 0 && dur < MAX_AD_DURATION && adVideo.currentTime < dur - 0.05) {
      adVideo.currentTime = dur;
    }
    clickSkipButton();
  }

  function enterAd() {
    var video = player.querySelector('video');
    if (!video) return;
    inAd = true;
    adVideo = video;

    savedMuted = video.muted;
    savedVolume = video.volume;
    realVideoStartTime = video.currentTime;

    video.muted = true;
    // Each ad in a pod fires loadedmetadata; durationchange covers late durations
    video.addEventListener('loadedmetadata', seekAdToEnd, true);
    video.addEventListener('durationchange', seekAdToEnd, true);
    seekAdToEnd();
  }

  function exitAd() {
    var video = adVideo;
    inAd = false;
    adVideo = null;
    if (!video) return;

    video.removeEventListener('loadedmetadata', seekAdToEnd, true);
    video.removeEventListener('durationchange', seekAdToEnd, true);
    video.muted = savedMuted;
    video.volume = savedVolume;

    var endedAt = Date.now();
    var startAt = realVideoStartTime;
    var restore = function () {
      if (stopped) return;
      if (player && playerInAdMode(player)) return;
      cleanup();
      if (Date.now() - endedAt > RESTORE_WINDOW_MS) return;
      // A seek that landed on the real video leaves it parked at its end
      var dur = video.duration;
      if (Number.isFinite(dur) && dur > 0 && video.currentTime >= dur - 1 && startAt < dur - 1) {
        video.currentTime = startAt;
      }
      if (video.paused) {
        var p = video.play();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      }
    };
    var cleanup = function () {
      video.removeEventListener('loadeddata', restore, true);
      video.removeEventListener('playing', restore, true);
      video.removeEventListener('canplay', restore, true);
    };
    video.addEventListener('loadeddata', restore, true);
    video.addEventListener('playing', restore, true);
    video.addEventListener('canplay', restore, true);
  }

  function onPlayerClass() {
    if (stopped || !player) return;
    var ad = playerInAdMode(player);
    if (ad && !inAd) enterAd();
    else if (!ad && inAd) exitAd();
  }

  /* ── Enforcement dialog ──────────────────────────────────────── */

  function closeEnforcementDialog(node) {
    if (stopped) return;
    var target = node.matches && node.matches(ENFORCEMENT_SEL)
      ? node
      : node.querySelector && node.querySelector(ENFORCEMENT_SEL);
    if (!target) return;

    var dialog = target.closest('tp-yt-paper-dialog') || target;
    try {
      if (typeof dialog.close === 'function') dialog.close();
    } catch (_) {}
    dialog.removeAttribute('opened');
    dialog.classList.remove('opened');

    // The dimmer stays up if only the attribute is cleared; opacity comes from .opened
    document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach(function (backdrop) {
      backdrop.classList.remove('opened');
      backdrop.removeAttribute('opened');
      try { backdrop.remove(); } catch (_) {}
    });
    [document.documentElement, document.body].forEach(function (el) {
      if (!el) return;
      el.classList.remove('no-scroll', 'no-y-scroll');
      if (el.style.overflow === 'hidden') el.style.overflow = '';
      if (el.style.overflowY === 'hidden') el.style.overflowY = '';
    });

    var video = player && player.querySelector('video');
    if (video && video.paused) {
      var p = video.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    }
  }

  /* ── Single observer ─────────────────────────────────────────── */

  // Until both targets exist the observer also watches the whole document;
  // after that it only sees player class changes and popup insertions.
  var discovering = true;

  var observer = new MutationObserver(function (records) {
    if (stopped) return;
    var classChanged = false;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === 'attributes') {
        classChanged = true;
      } else if (!discovering) {
        for (var j = 0; j < r.addedNodes.length; j++) {
          if (r.addedNodes[j].nodeType === 1) closeEnforcementDialog(r.addedNodes[j]);
        }
      }
    }
    if (classChanged) onPlayerClass();
    if (discovering) discover();
  });

  function discover() {
    if (!player) {
      player = document.getElementById('movie_player');
      if (player) {
        observer.observe(player, { attributes: true, attributeFilter: ['class'] });
        onPlayerClass();
      }
    }
    if (!popupContainer) {
      popupContainer = document.querySelector('ytd-popup-container');
    }
    if (player && popupContainer) {
      discovering = false;
      observer.disconnect();
      observer.observe(player, { attributes: true, attributeFilter: ['class'] });
      observer.observe(popupContainer, { childList: true, subtree: true });
      if (document.body) observer.observe(document.body, { childList: true });
      // The wall may already be open by the time the popup container exists
      var existing = popupContainer.querySelector(ENFORCEMENT_SEL);
      if (existing) closeEnforcementDialog(existing);
    }
  }

  observer.observe(document.documentElement, { childList: true, subtree: true });
  discover();

  function shutdown() {
    if (stopped) return;
    stopped = true;
    ctlState.active = false;
    if (beatTimer) {
      clearTimeout(beatTimer);
      beatTimer = null;
    }
    try { observer.disconnect(); } catch (e) {}
    if (adVideo) {
      try {
        adVideo.muted = savedMuted;
        adVideo.volume = savedVolume;
      } catch (e2) {}
    }
    inAd = false;
    try { delete window.ytPlayerCtl; } catch (e3) {}
  }

  function beat() {
    if (stopped) return;
    var alive = false;
    try { alive = !!(chrome.runtime && chrome.runtime.id); } catch (e) { alive = false; }
    if (!alive) {
      try { document.dispatchEvent(new CustomEvent(CTL, { detail: 'release' })); } catch (e2) {}
      shutdown();
      return;
    }
    try { document.dispatchEvent(new CustomEvent(CTL, { detail: 'beat' })); } catch (e3) {}
    beatTimer = setTimeout(beat, 1500);
  }

  document.addEventListener(CTL, function (event) {
    if (event && event.detail === 'release') shutdown();
  });
  beatTimer = setTimeout(beat, 1500);
})();
