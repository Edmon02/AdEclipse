(function (root, factory) {
  var exports = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  }

  root.__ADECLIPSE_YT_UTILS__ = exports;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function clampPlaybackTarget(targetTime, duration) {
    if (!isFiniteNumber(targetTime) || targetTime < 0) return 0;

    if (isFiniteNumber(duration) && duration > 1) {
      return Math.min(targetTime, Math.max(duration - 0.25, 0));
    }

    return targetTime;
  }

  function getResumeTargetTime(candidates) {
    var best = 0;

    if (!Array.isArray(candidates)) return best;

    candidates.forEach(function (candidate) {
      if (isFiniteNumber(candidate) && candidate > best) {
        best = candidate;
      }
    });

    return best;
  }

  function shouldRestorePlaybackPosition(targetTime, currentTime, duration) {
    if (!isFiniteNumber(currentTime) || currentTime < 0) return false;

    var safeTarget = clampPlaybackTarget(targetTime, duration);
    if (safeTarget < 1) return false;

    var delta = currentTime - safeTarget;
    if (Math.abs(delta) <= 1.5) return false;

    if (currentTime <= Math.min(3, safeTarget * 0.25)) {
      return true;
    }

    if (delta > 15) {
      return true;
    }

    return false;
  }

  function extractScrollTargetY(argsLike) {
    if (!argsLike || typeof argsLike.length !== 'number' || argsLike.length === 0) {
      return null;
    }

    var first = argsLike[0];
    if (first && typeof first === 'object') {
      return isFiniteNumber(first.top) ? first.top : null;
    }

    return isFiniteNumber(argsLike[1]) ? argsLike[1] : null;
  }

  function getScrollDirectionFromPositions(previousY, nextY) {
    if (!isFiniteNumber(previousY) || !isFiniteNumber(nextY)) return 0;

    if (nextY > previousY + 2) return 1;
    if (nextY < previousY - 2) return -1;
    return 0;
  }

  function shouldBlockProgrammaticScroll(targetY, protectedY, scrollDirection, activeUntil, now) {
    if (!isFiniteNumber(targetY) || !isFiniteNumber(protectedY)) return false;
    if (!scrollDirection || now > activeUntil) return false;

    if (scrollDirection > 0) {
      return targetY < protectedY - 120;
    }

    return targetY > protectedY + 120;
  }

  function shouldRecoverScrollPosition(currentY, protectedY, scrollDirection, activeUntil, now) {
    if (!isFiniteNumber(currentY) || !isFiniteNumber(protectedY)) return false;
    if (!scrollDirection || now > activeUntil) return false;

    if (scrollDirection > 0) {
      return currentY < protectedY - 140;
    }

    return currentY > protectedY + 140;
  }

  return {
    clampPlaybackTarget: clampPlaybackTarget,
    extractScrollTargetY: extractScrollTargetY,
    getResumeTargetTime: getResumeTargetTime,
    getScrollDirectionFromPositions: getScrollDirectionFromPositions,
    shouldBlockProgrammaticScroll: shouldBlockProgrammaticScroll,
    shouldRecoverScrollPosition: shouldRecoverScrollPosition,
    shouldRestorePlaybackPosition: shouldRestorePlaybackPosition
  };
});