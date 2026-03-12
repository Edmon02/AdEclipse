(function () {
  'use strict';

  if (window.__ADECLIPSE_GENERAL_MAINWORLD__) return;
  window.__ADECLIPSE_GENERAL_MAINWORLD__ = true;

  var lastGesture = {
    time: 0,
    href: '',
    action: '',
    isTrusted: false
  };

  function normalizeUrl(url) {
    if (!url) return '';

    try {
      var parsed = new URL(url, window.location.href);
      parsed.hash = '';
      return parsed.toString();
    } catch (_) {
      return String(url || '').trim();
    }
  }

  function isSameOrigin(url) {
    try {
      return new URL(url, window.location.href).origin === window.location.origin;
    } catch (_) {
      return false;
    }
  }

  function isSuspiciousPopupUrl(url) {
    var normalized = normalizeUrl(url).toLowerCase();
    if (!normalized) return true;

    return (
      normalized === 'about:blank' ||
      normalized.indexOf('javascript:') === 0 ||
      normalized.indexOf('data:') === 0 ||
      normalized.indexOf('blob:') === 0
    );
  }

  function hasRecentTrustedGesture() {
    return lastGesture.isTrusted && (Date.now() - lastGesture.time) < 1500;
  }

  function navigationMatchesGesture(url) {
    var normalized = normalizeUrl(url);
    if (!normalized) return false;

    return normalized === normalizeUrl(lastGesture.href) ||
      normalized === normalizeUrl(lastGesture.action);
  }

  function rememberGesture(event) {
    var isTrustedGesture = event.isTrusted || event.__adeclipseTrusted === true;
    if (!isTrustedGesture) return;

    var target = event.target && event.target.nodeType === 1 ? event.target : null;
    var anchor = target && target.closest ? target.closest('a[href]') : null;
    var form = target && target.closest ? target.closest('form[action]') : null;

    lastGesture = {
      time: Date.now(),
      href: anchor ? anchor.href : '',
      action: form ? form.action : '',
      isTrusted: true
    };
  }

  function shouldAllowNavigation(url) {
    if (!hasRecentTrustedGesture()) {
      return false;
    }

    if (navigationMatchesGesture(url)) {
      return true;
    }

    if (isSameOrigin(url)) {
      return true;
    }

    return false;
  }

  function shouldAllowPopup(url) {
    if (!hasRecentTrustedGesture()) {
      return false;
    }

    if (isSuspiciousPopupUrl(url)) {
      return false;
    }

    if (navigationMatchesGesture(url)) {
      return true;
    }

    return isSameOrigin(url);
  }

  ['pointerdown', 'mousedown', 'click', 'auxclick', 'touchstart', 'keydown'].forEach(function (type) {
    window.addEventListener(type, rememberGesture, true);
  });

  var originalOpen = window.open;
  window.open = function (url, target, features) {
    if (shouldAllowPopup(url)) {
      return originalOpen.apply(this, arguments);
    }

    return null;
  };

  var originalAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!shouldAllowNavigation(this.href)) {
      return;
    }

    return originalAnchorClick.apply(this, arguments);
  };

  try {
    var originalAssign = Location.prototype.assign;
    Location.prototype.assign = function (url) {
      if (!shouldAllowNavigation(url)) {
        return;
      }

      return originalAssign.call(this, url);
    };
  } catch (_) { }

  try {
    var originalReplace = Location.prototype.replace;
    Location.prototype.replace = function (url) {
      if (!shouldAllowNavigation(url)) {
        return;
      }

      return originalReplace.call(this, url);
    };
  } catch (_) { }
})();
