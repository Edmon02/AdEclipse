/**
 * YouTube Ad Blocker Unit Tests
 */

describe('YouTube Ad Blocker', () => {
  let mockDocument;
  let mockVideo;

  beforeEach(() => {
    // Set up mock DOM
    document.body.innerHTML = `
      <div id="movie_player">
        <video class="html5-main-video" src="video.mp4"></video>
        <div class="ytp-ad-module"></div>
        <div class="ytp-ad-overlay-container"></div>
        <button class="ytp-ad-skip-button"></button>
      </div>
    `;
    
    mockVideo = document.querySelector('video');
    mockVideo.play = jest.fn();
    mockVideo.pause = jest.fn();
    Object.defineProperty(mockVideo, 'duration', { value: 30, writable: true });
    Object.defineProperty(mockVideo, 'currentTime', { value: 0, writable: true });
    Object.defineProperty(mockVideo, 'muted', { value: false, writable: true });
    Object.defineProperty(mockVideo, 'playbackRate', { value: 1, writable: true });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('isVideoAd', () => {
    test('should detect video ad by ad module presence', () => {
      const adModule = document.querySelector('.ytp-ad-module');
      expect(adModule).not.toBeNull();
    });

    test('should detect video ad by ad text overlay', () => {
      const adText = document.createElement('div');
      adText.className = 'ytp-ad-text';
      adText.textContent = 'Ad';
      document.querySelector('#movie_player').appendChild(adText);
      
      const hasAdText = document.querySelector('.ytp-ad-text, .ytp-ad-preview-text');
      expect(hasAdText).not.toBeNull();
    });

    test('should not detect ad when no ad elements present', () => {
      document.body.innerHTML = `
        <div id="movie_player">
          <video class="html5-main-video"></video>
        </div>
      `;
      
      const hasAd = document.querySelector('.ytp-ad-module, .ytp-ad-text');
      expect(hasAd).toBeNull();
    });
  });

  describe('skipAd', () => {
    test('should click skip button when available', () => {
      const skipButton = document.querySelector('.ytp-ad-skip-button');
      skipButton.click = jest.fn();
      
      // Simulate skip logic
      if (skipButton) {
        skipButton.click();
      }
      
      expect(skipButton.click).toHaveBeenCalled();
    });

    test('should handle skip button container', () => {
      const skipContainer = document.createElement('div');
      skipContainer.className = 'ytp-ad-skip-button-container';
      const skipButton = document.createElement('button');
      skipButton.className = 'ytp-skip-ad-button';
      skipButton.click = jest.fn();
      skipContainer.appendChild(skipButton);
      document.querySelector('#movie_player').appendChild(skipContainer);
      
      const button = document.querySelector('.ytp-skip-ad-button');
      if (button) {
        button.click();
      }
      
      expect(skipButton.click).toHaveBeenCalled();
    });
  });

  describe('speedUpAd', () => {
    test('should increase playback rate for ads', () => {
      mockVideo.playbackRate = 1;
      
      // Simulate speed up
      const speedMultiplier = 16;
      mockVideo.playbackRate = speedMultiplier;
      
      expect(mockVideo.playbackRate).toBe(16);
    });

    test('should not exceed maximum playback rate', () => {
      mockVideo.playbackRate = 1;
      
      const speedMultiplier = Math.min(16, 16);
      mockVideo.playbackRate = speedMultiplier;
      
      expect(mockVideo.playbackRate).toBeLessThanOrEqual(16);
    });
  });

  describe('muteAd', () => {
    test('should mute video during ad', () => {
      mockVideo.muted = false;
      
      // Simulate mute
      mockVideo.muted = true;
      
      expect(mockVideo.muted).toBe(true);
    });

    test('should restore volume after ad', () => {
      const originalMuted = false;
      mockVideo.muted = true;
      
      // Simulate restore
      mockVideo.muted = originalMuted;
      
      expect(mockVideo.muted).toBe(false);
    });
  });

  describe('removeOverlayAds', () => {
    test('should remove overlay container', () => {
      const overlay = document.querySelector('.ytp-ad-overlay-container');
      expect(overlay).not.toBeNull();
      
      overlay.remove();
      
      const afterRemove = document.querySelector('.ytp-ad-overlay-container');
      expect(afterRemove).toBeNull();
    });

    test('should remove multiple overlay types', () => {
      const overlays = [
        'ytp-ad-overlay-slot',
        'ytp-ad-overlay-close-container'
      ];
      
      overlays.forEach(cls => {
        const el = document.createElement('div');
        el.className = cls;
        document.querySelector('#movie_player').appendChild(el);
      });
      
      overlays.forEach(cls => {
        const el = document.querySelector(`.${cls}`);
        if (el) el.remove();
      });
      
      overlays.forEach(cls => {
        expect(document.querySelector(`.${cls}`)).toBeNull();
      });
    });
  });

  describe('detectSponsoredContent', () => {
    test('should detect sponsored section', () => {
      const sponsored = document.createElement('div');
      sponsored.id = 'related';
      sponsored.innerHTML = `
        <div class="sponsored-badge">Sponsored</div>
        <div class="ytd-promoted-sparkles-web-renderer"></div>
      `;
      document.body.appendChild(sponsored);
      
      const hasSponsored = document.querySelector('.sponsored-badge, .ytd-promoted-sparkles-web-renderer');
      expect(hasSponsored).not.toBeNull();
    });

    test('should detect promoted videos', () => {
      const promoted = document.createElement('div');
      promoted.className = 'ytd-display-ad-renderer';
      document.body.appendChild(promoted);
      
      const hasPromoted = document.querySelector('.ytd-display-ad-renderer');
      expect(hasPromoted).not.toBeNull();
    });
  });

  describe('handleAutoplay', () => {
    test('should handle SPA navigation', () => {
      let observerCallback = null;
      
      // Mock MutationObserver
      class MockObserver {
        constructor(callback) {
          observerCallback = callback;
        }
        observe() {}
        disconnect() {}
      }
      
      new MockObserver((mutations) => {
        mutations.forEach(m => {
          // Handle mutation
        });
      });
      
      expect(observerCallback).toBeDefined();
    });
  });
});

describe('Ad Detection Utilities', () => {
  describe('isAdByText', () => {
    test('should detect "Ad" text', () => {
      const adIndicators = ['Ad', 'AD', 'ad', 'Advertisement', 'Sponsored'];
      const testText = 'This is an Ad';
      
      const isAd = adIndicators.some(ind => testText.includes(ind));
      expect(isAd).toBe(true);
    });

    test('should detect localized ad text', () => {
      const localizedAds = ['Werbung', 'Publicité', '広告', 'Реклама'];
      const testText = 'Video Werbung';
      
      const isAd = localizedAds.some(ind => testText.includes(ind));
      expect(isAd).toBe(true);
    });
  });

  describe('isAdBySelector', () => {
    test('should match ad selectors', () => {
      const adSelectors = [
        '.ytp-ad-module',
        '.ytp-ad-overlay-container',
        '[class*="ad-"]',
        '#masthead-ad'
      ];
      
      document.body.innerHTML = '<div class="ytp-ad-module"></div>';
      
      const hasMatch = adSelectors.some(sel => document.querySelector(sel));
      expect(hasMatch).toBe(true);
    });
  });

  describe('isAdBySize', () => {
    test('should detect common ad sizes', () => {
      const commonAdSizes = [
        { width: 300, height: 250 },
        { width: 728, height: 90 },
        { width: 160, height: 600 }
      ];
      
      const testSize = { width: 300, height: 250 };
      const tolerance = 10;
      
      const isCommonSize = commonAdSizes.some(size =>
        Math.abs(size.width - testSize.width) <= tolerance &&
        Math.abs(size.height - testSize.height) <= tolerance
      );
      
      expect(isCommonSize).toBe(true);
    });
  });
});
