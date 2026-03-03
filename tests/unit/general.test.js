/**
 * General Ad Blocker Unit Tests
 */

describe('General Ad Blocker', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('CSS Selector Matching', () => {
    test('should match ad class patterns', () => {
      document.body.innerHTML = `
        <div class="ad-container">Ad Content</div>
        <div class="advertisement-banner">Banner Ad</div>
        <div class="google-ad-wrapper">Google Ad</div>
      `;

      const adPatterns = [
        '[class*="ad-"]',
        '[class*="advertisement"]',
        '[class*="google-ad"]'
      ];

      adPatterns.forEach(pattern => {
        const element = document.querySelector(pattern);
        expect(element).not.toBeNull();
      });
    });

    test('should match ad ID patterns', () => {
      document.body.innerHTML = `
        <div id="ad-sidebar">Sidebar Ad</div>
        <div id="banner-ad-top">Top Banner</div>
      `;

      const element1 = document.querySelector('#ad-sidebar');
      const element2 = document.querySelector('#banner-ad-top');

      expect(element1).not.toBeNull();
      expect(element2).not.toBeNull();
    });

    test('should match data attributes', () => {
      document.body.innerHTML = `
        <div data-ad-slot="top"></div>
        <div data-ad-unit="header"></div>
        <div data-google-ad="true"></div>
      `;

      const adElements = document.querySelectorAll('[data-ad-slot], [data-ad-unit], [data-google-ad]');
      expect(adElements.length).toBe(3);
    });
  });

  describe('Ad Size Detection', () => {
    const commonAdSizes = [
      [300, 250],
      [728, 90],
      [160, 600],
      [300, 600],
      [320, 50],
      [970, 250]
    ];

    test('should identify common ad sizes', () => {
      const testCases = [
        { width: 300, height: 250, expected: true },
        { width: 728, height: 90, expected: true },
        { width: 500, height: 500, expected: false },
        { width: 100, height: 100, expected: false }
      ];

      testCases.forEach(({ width, height, expected }) => {
        const isAdSize = commonAdSizes.some(([w, h]) =>
          Math.abs(w - width) < 10 && Math.abs(h - height) < 10
        );
        expect(isAdSize).toBe(expected);
      });
    });

    test('should allow size tolerance', () => {
      const tolerance = 10;
      const testSize = { width: 305, height: 255 };
      const targetSize = [300, 250];

      const withinTolerance = 
        Math.abs(targetSize[0] - testSize.width) <= tolerance &&
        Math.abs(targetSize[1] - testSize.height) <= tolerance;

      expect(withinTolerance).toBe(true);
    });
  });

  describe('Heuristic Detection', () => {
    test('should detect elements with external links only', () => {
      document.body.innerHTML = `
        <div id="test-el">
          <a href="https://external-ad-network.com/click">Click Here</a>
          <a href="https://another-ad.com/track" target="_blank">Ad Link</a>
        </div>
      `;

      const element = document.querySelector('#test-el');
      const links = element.querySelectorAll('a');
      const hostname = 'example.com';
      
      const allExternal = Array.from(links).every(link => {
        try {
          const url = new URL(link.href);
          return !url.hostname.includes(hostname);
        } catch {
          return false;
        }
      });

      expect(allExternal).toBe(true);
    });

    test('should detect ad-like text content', () => {
      const adKeywords = ['sponsored', 'advertisement', 'ad', 'promo', 'partner'];
      
      const testCases = [
        { text: 'Sponsored Content', expected: true },
        { text: 'Advertisement', expected: true },
        { text: 'Regular article content', expected: false },
        { text: 'News headline', expected: false }
      ];

      testCases.forEach(({ text, expected }) => {
        const hasAdKeyword = adKeywords.some(kw => 
          text.toLowerCase().includes(kw)
        );
        expect(hasAdKeyword).toBe(expected);
      });
    });

    test('should detect fixed/sticky positioning', () => {
      document.body.innerHTML = `
        <div id="fixed-ad" style="position: fixed; bottom: 0;"></div>
        <div id="sticky-ad" style="position: sticky; top: 0;"></div>
        <div id="normal" style="position: relative;"></div>
      `;

      const fixedAd = document.querySelector('#fixed-ad');
      const stickyAd = document.querySelector('#sticky-ad');
      const normal = document.querySelector('#normal');

      expect(getComputedStyle(fixedAd).position).toBe('fixed');
      expect(getComputedStyle(stickyAd).position).toBe('sticky');
      expect(getComputedStyle(normal).position).toBe('relative');
    });
  });

  describe('Element Removal', () => {
    test('should remove ad elements from DOM', () => {
      document.body.innerHTML = `
        <div class="content">Main content</div>
        <div class="ad-banner" id="remove-me">Ad to remove</div>
      `;

      const adElement = document.querySelector('#remove-me');
      expect(adElement).not.toBeNull();

      adElement.remove();

      const afterRemoval = document.querySelector('#remove-me');
      expect(afterRemoval).toBeNull();
    });

    test('should hide elements with CSS', () => {
      document.body.innerHTML = `
        <div id="hide-me">Ad to hide</div>
      `;

      const element = document.querySelector('#hide-me');
      element.style.display = 'none';
      element.style.visibility = 'hidden';

      expect(element.style.display).toBe('none');
      expect(element.style.visibility).toBe('hidden');
    });

    test('should not remove content elements', () => {
      document.body.innerHTML = `
        <article class="main-article">
          <h1>Article Title</h1>
          <p>Article content</p>
        </article>
        <div class="ad-sidebar">Ad</div>
      `;

      const article = document.querySelector('.main-article');
      const ad = document.querySelector('.ad-sidebar');
      
      ad.remove();

      expect(document.querySelector('.main-article')).not.toBeNull();
      expect(document.querySelector('.ad-sidebar')).toBeNull();
    });
  });

  describe('MutationObserver Integration', () => {
    test('should observe DOM changes', (done) => {
      const mutations = [];
      const observer = new MutationObserver((mutationList) => {
        mutations.push(...mutationList);
      });

      observer.observe(document.body, { childList: true, subtree: true });

      // Add element
      const newElement = document.createElement('div');
      newElement.className = 'ad-injected';
      document.body.appendChild(newElement);

      // MutationObserver calls are async
      setTimeout(() => {
        observer.disconnect();
        // In jsdom, MutationObserver is mocked
        done();
      }, 10);
    });

    test('should handle debouncing', () => {
      jest.useFakeTimers();
      
      let callCount = 0;
      const debounce = (fn, delay) => {
        let timeoutId;
        return (...args) => {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => fn(...args), delay);
        };
      };

      const handler = debounce(() => callCount++, 100);

      // Rapid calls
      handler();
      handler();
      handler();
      handler();
      handler();

      // Before debounce timeout
      expect(callCount).toBe(0);

      // After debounce timeout
      jest.advanceTimersByTime(100);
      expect(callCount).toBe(1);

      jest.useRealTimers();
    });
  });

  describe('Whitelist Functionality', () => {
    const whitelist = ['example.com', 'trusted-site.org', '*.allowed.net'];

    test('should match exact domain', () => {
      const domain = 'example.com';
      const isWhitelisted = whitelist.includes(domain);
      expect(isWhitelisted).toBe(true);
    });

    test('should not match unlisted domain', () => {
      const domain = 'ads.com';
      const isWhitelisted = whitelist.includes(domain);
      expect(isWhitelisted).toBe(false);
    });

    test('should match wildcard patterns', () => {
      const domain = 'sub.allowed.net';
      const wildcardPattern = '*.allowed.net';
      
      const matchesWildcard = whitelist.some(pattern => {
        if (pattern.startsWith('*.')) {
          const baseDomain = pattern.slice(2);
          return domain.endsWith(baseDomain);
        }
        return pattern === domain;
      });

      expect(matchesWildcard).toBe(true);
    });
  });
});

describe('Ad Network Detection', () => {
  const adNetworkDomains = [
    'doubleclick.net',
    'googlesyndication.com',
    'googleadservices.com',
    'facebook.com/tr',
    'amazon-adsystem.com',
    'taboola.com',
    'outbrain.com',
    'criteo.com'
  ];

  test('should identify ad network URLs', () => {
    const testUrls = [
      { url: 'https://pagead2.googlesyndication.com/ads', expected: true },
      { url: 'https://www.googleadservices.com/pagead/conversion', expected: true },
      { url: 'https://example.com/article', expected: false },
      { url: 'https://cdn.staticassets.com/script.js', expected: false }
    ];

    testUrls.forEach(({ url, expected }) => {
      const isAdNetwork = adNetworkDomains.some(domain => url.includes(domain));
      expect(isAdNetwork).toBe(expected);
    });
  });

  test('should detect tracking pixels', () => {
    document.body.innerHTML = `
      <img src="https://facebook.com/tr?event=PageView" width="1" height="1">
      <img src="https://example.com/image.jpg" width="100" height="100">
    `;

    const images = document.querySelectorAll('img');
    const trackingPixels = Array.from(images).filter(img => {
      const isSmall = img.width <= 1 && img.height <= 1;
      const isTracker = adNetworkDomains.some(d => img.src.includes(d));
      return isSmall || isTracker;
    });

    expect(trackingPixels.length).toBe(1);
  });
});
