const {
  clampPlaybackTarget,
  extractScrollTargetY,
  getResumeTargetTime,
  getScrollDirectionFromPositions,
  shouldBlockProgrammaticScroll,
  shouldRecoverScrollPosition,
  shouldRestorePlaybackPosition
} = require('../../src/content/youtube-utils.js');

describe('YouTube utility helpers', () => {
  describe('playback resume helpers', () => {
    test('prefers the best available resume target', () => {
      expect(getResumeTargetTime([0, 182.5, 90])).toBe(182.5);
    });

    test('clamps a playback target to the real video duration', () => {
      expect(clampPlaybackTarget(301, 300)).toBe(299.75);
    });

    test('restores playback when the real video was reset near the beginning', () => {
      expect(shouldRestorePlaybackPosition(245, 1.2, 900)).toBe(true);
    });

    test('does not restore playback when YouTube already resumed correctly', () => {
      expect(shouldRestorePlaybackPosition(245, 244.4, 900)).toBe(false);
    });

    test('restores playback when ad handling jumps far beyond the saved position', () => {
      expect(shouldRestorePlaybackPosition(120, 165, 900)).toBe(true);
    });
  });

  describe('scroll helpers', () => {
    test('extracts scroll targets from positional and object arguments', () => {
      expect(extractScrollTargetY([0, 420])).toBe(420);
      expect(extractScrollTargetY([{ top: 640, behavior: 'smooth' }])).toBe(640);
    });

    test('derives scroll direction from observed positions', () => {
      expect(getScrollDirectionFromPositions(100, 180)).toBe(1);
      expect(getScrollDirectionFromPositions(180, 100)).toBe(-1);
      expect(getScrollDirectionFromPositions(180, 181)).toBe(0);
    });

    test('blocks reverse snap-back scrolls only during an active user scroll session', () => {
      expect(shouldBlockProgrammaticScroll(100, 480, 1, 2000, 1000)).toBe(true);
      expect(shouldBlockProgrammaticScroll(100, 480, 1, 900, 1000)).toBe(false);
    });

    test('recovers when the page is snapped away from the protected wheel position', () => {
      expect(shouldRecoverScrollPosition(150, 480, 1, 2000, 1000)).toBe(true);
      expect(shouldRecoverScrollPosition(430, 480, 1, 2000, 1000)).toBe(false);
    });
  });
});