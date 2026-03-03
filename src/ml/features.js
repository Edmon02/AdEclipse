/**
 * AdEclipse ML Feature Extractor
 * Extracts features from DOM elements for ML classification
 */

class FeatureExtractor {
  constructor() {
    this.adKeywords = [
      'ad', 'ads', 'advert', 'advertisement', 'banner', 'sponsor',
      'sponsored', 'promo', 'promotion', 'partner', 'affiliate',
      'commercial', 'marketing', 'campaign', 'recommended', 'suggested'
    ];

    this.adPatterns = [
      /ad[s]?[-_]?(unit|slot|container|wrapper|block|space|zone)/i,
      /banner[-_]?(ad|300|728|160)/i,
      /sponsor(ed)?[-_]?(content|post|link)/i,
      /google[-_]?(ad|syndication)/i,
      /taboola|outbrain|mgid|revcontent/i,
      /\bad[sx]?\b/i,
      /dfp|doubleclick|adsense/i
    ];

    this.commonAdSizes = [
      [300, 250], [728, 90], [160, 600], [300, 600],
      [320, 50], [320, 100], [970, 90], [970, 250],
      [336, 280], [300, 50], [468, 60], [234, 60],
      [120, 600], [250, 250], [180, 150]
    ];
  }

  /**
   * Extract comprehensive features from an element
   */
  extract(element) {
    return {
      ...this.extractSizeFeatures(element),
      ...this.extractPositionFeatures(element),
      ...this.extractStyleFeatures(element),
      ...this.extractContentFeatures(element),
      ...this.extractAttributeFeatures(element),
      ...this.extractStructureFeatures(element),
      ...this.extractLinkFeatures(element),
      ...this.extractContextFeatures(element)
    };
  }

  /**
   * Extract as flat array for ML model
   */
  extractAsArray(element) {
    const features = this.extract(element);
    return Object.values(features);
  }

  /**
   * Size-related features
   */
  extractSizeFeatures(element) {
    const rect = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const area = rect.width * rect.height;
    const viewportArea = viewportWidth * viewportHeight;

    // Check if matches common ad sizes
    const isCommonAdSize = this.commonAdSizes.some(([w, h]) => 
      Math.abs(rect.width - w) < 10 && Math.abs(rect.height - h) < 10
    );

    return {
      width: rect.width,
      height: rect.height,
      normalizedWidth: rect.width / viewportWidth,
      normalizedHeight: rect.height / viewportHeight,
      area: area,
      normalizedArea: area / viewportArea,
      aspectRatio: rect.width / (rect.height || 1),
      isSmall: area < 10000 ? 1 : 0,
      isMedium: area >= 10000 && area < 100000 ? 1 : 0,
      isLarge: area >= 100000 ? 1 : 0,
      isCommonAdSize: isCommonAdSize ? 1 : 0
    };
  }

  /**
   * Position-related features
   */
  extractPositionFeatures(element) {
    const rect = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Calculate center position
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    return {
      top: rect.top,
      left: rect.left,
      normalizedTop: rect.top / viewportHeight,
      normalizedLeft: rect.left / viewportWidth,
      normalizedCenterX: centerX / viewportWidth,
      normalizedCenterY: centerY / viewportHeight,
      isAboveFold: rect.bottom <= viewportHeight ? 1 : 0,
      isBelowFold: rect.top > viewportHeight ? 1 : 0,
      isInSidebar: rect.left > viewportWidth * 0.7 || rect.right < viewportWidth * 0.3 ? 1 : 0,
      isInHeader: rect.top < 200 ? 1 : 0,
      isInFooter: rect.top > viewportHeight - 200 ? 1 : 0,
      isSticky: this.isElementSticky(element) ? 1 : 0
    };
  }

  /**
   * Style-related features
   */
  extractStyleFeatures(element) {
    const style = window.getComputedStyle(element);

    return {
      isFixed: style.position === 'fixed' ? 1 : 0,
      isAbsolute: style.position === 'absolute' ? 1 : 0,
      hasHighZIndex: parseInt(style.zIndex) > 100 ? 1 : 0,
      isTransparent: parseFloat(style.opacity) < 1 ? 1 : 0,
      hasTransform: style.transform !== 'none' ? 1 : 0,
      hasBorder: parseInt(style.borderWidth) > 0 ? 1 : 0,
      hasBoxShadow: style.boxShadow !== 'none' ? 1 : 0,
      hasAnimation: style.animationName !== 'none' ? 1 : 0,
      isOverflowHidden: style.overflow === 'hidden' ? 1 : 0,
      displayType: this.encodeDisplayType(style.display)
    };
  }

  /**
   * Content-related features
   */
  extractContentFeatures(element) {
    const text = (element.textContent || '').toLowerCase();
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

    // Count ad-related keywords
    const keywordMatches = this.adKeywords.filter(kw => text.includes(kw)).length;

    return {
      textLength: text.length,
      wordCount: wordCount,
      normalizedTextLength: Math.min(text.length / 1000, 1),
      hasAdKeywords: keywordMatches > 0 ? 1 : 0,
      adKeywordCount: keywordMatches,
      adKeywordDensity: keywordMatches / (wordCount || 1),
      hasSponsored: /sponsor/i.test(text) ? 1 : 0,
      hasAdvertisement: /advertis/i.test(text) ? 1 : 0,
      hasPromo: /promo/i.test(text) ? 1 : 0,
      isEmpty: text.trim().length === 0 ? 1 : 0
    };
  }

  /**
   * Attribute-related features
   */
  extractAttributeFeatures(element) {
    const id = element.id || '';
    const className = element.className || '';
    const attrs = `${id} ${className}`.toLowerCase();

    // Check patterns
    const patternMatches = this.adPatterns.filter(p => p.test(attrs)).length;

    // Data attributes
    const dataAttrs = Array.from(element.attributes)
      .filter(a => a.name.startsWith('data-'))
      .map(a => a.value.toLowerCase())
      .join(' ');

    const hasAdDataAttr = /ad|sponsor|promo|campaign/i.test(dataAttrs);

    return {
      hasAdInId: /ad[s]?/i.test(id) ? 1 : 0,
      hasAdInClass: /ad[s]?/i.test(className) ? 1 : 0,
      hasBannerInClass: /banner/i.test(className) ? 1 : 0,
      hasSponsorInAttrs: /sponsor/i.test(attrs) ? 1 : 0,
      patternMatchCount: patternMatches,
      hasAdDataAttr: hasAdDataAttr ? 1 : 0,
      hasRole: element.hasAttribute('role') ? 1 : 0,
      hasAriaLabel: element.hasAttribute('aria-label') ? 1 : 0,
      classCount: (className.match(/\s+/g) || []).length + 1,
      hasGoogleAd: /google|dfp|doubleclick/i.test(attrs) ? 1 : 0
    };
  }

  /**
   * Structure-related features
   */
  extractStructureFeatures(element) {
    const children = element.children.length;
    const depth = this.getElementDepth(element);

    return {
      childCount: children,
      normalizedChildCount: Math.min(children / 20, 1),
      hasIframe: element.querySelector('iframe') ? 1 : 0,
      iframeCount: element.querySelectorAll('iframe').length,
      hasImage: element.querySelector('img') ? 1 : 0,
      imageCount: element.querySelectorAll('img').length,
      hasVideo: element.querySelector('video') ? 1 : 0,
      hasScript: element.querySelector('script') ? 1 : 0,
      hasCanvas: element.querySelector('canvas') ? 1 : 0,
      hasSvg: element.querySelector('svg') ? 1 : 0,
      depth: depth,
      normalizedDepth: Math.min(depth / 15, 1),
      isIframe: element.tagName === 'IFRAME' ? 1 : 0
    };
  }

  /**
   * Link-related features
   */
  extractLinkFeatures(element) {
    const links = element.querySelectorAll('a');
    const totalLinks = links.length;
    const hostname = window.location.hostname;

    let externalLinks = 0;
    let blankTargetLinks = 0;
    let adNetworkLinks = 0;

    const adNetworkDomains = [
      'doubleclick', 'googlesyndication', 'googleadservices',
      'facebook', 'taboola', 'outbrain', 'criteo', 'amazon-adsystem'
    ];

    links.forEach(link => {
      try {
        const url = new URL(link.href);
        if (!url.hostname.includes(hostname)) {
          externalLinks++;
        }
        if (adNetworkDomains.some(d => url.hostname.includes(d))) {
          adNetworkLinks++;
        }
      } catch (e) {}
      
      if (link.target === '_blank') {
        blankTargetLinks++;
      }
    });

    return {
      linkCount: totalLinks,
      normalizedLinkCount: Math.min(totalLinks / 10, 1),
      externalLinkCount: externalLinks,
      externalLinkRatio: externalLinks / (totalLinks || 1),
      blankTargetCount: blankTargetLinks,
      hasAdNetworkLink: adNetworkLinks > 0 ? 1 : 0,
      adNetworkLinkCount: adNetworkLinks,
      hasOnlyExternalLinks: totalLinks > 0 && externalLinks === totalLinks ? 1 : 0
    };
  }

  /**
   * Context-related features
   */
  extractContextFeatures(element) {
    const parent = element.parentElement;
    const siblings = parent ? parent.children.length : 0;

    // Check nearby elements
    const rect = element.getBoundingClientRect();
    const nearbyAds = document.querySelectorAll('[class*="ad"], [id*="ad"]');
    let nearbyAdCount = 0;
    
    nearbyAds.forEach(ad => {
      if (ad !== element) {
        const adRect = ad.getBoundingClientRect();
        const distance = Math.sqrt(
          Math.pow(rect.left - adRect.left, 2) + 
          Math.pow(rect.top - adRect.top, 2)
        );
        if (distance < 500) nearbyAdCount++;
      }
    });

    return {
      siblingCount: siblings,
      normalizedSiblingCount: Math.min(siblings / 10, 1),
      nearbyAdCount: nearbyAdCount,
      parentHasAdClass: parent && /ad[s]?/i.test(parent.className || '') ? 1 : 0,
      isInMain: this.isInElement(element, 'main, [role="main"], article') ? 1 : 0,
      isInAside: this.isInElement(element, 'aside, [role="complementary"]') ? 1 : 0,
      isInNav: this.isInElement(element, 'nav, [role="navigation"]') ? 1 : 0,
      pageHasAds: document.querySelectorAll('[class*="ad"], [id*="ad"]').length > 5 ? 1 : 0
    };
  }

  /**
   * Helper: Check if element is sticky
   */
  isElementSticky(element) {
    let el = element;
    while (el) {
      const style = window.getComputedStyle(el);
      if (style.position === 'sticky' || style.position === 'fixed') {
        return true;
      }
      el = el.parentElement;
    }
    return false;
  }

  /**
   * Helper: Get element depth in DOM
   */
  getElementDepth(element) {
    let depth = 0;
    let el = element;
    while (el.parentElement) {
      depth++;
      el = el.parentElement;
    }
    return depth;
  }

  /**
   * Helper: Check if element is inside selector
   */
  isInElement(element, selector) {
    return element.closest(selector) !== null;
  }

  /**
   * Helper: Encode display type as number
   */
  encodeDisplayType(display) {
    const types = ['none', 'block', 'inline', 'inline-block', 'flex', 'grid'];
    const index = types.indexOf(display);
    return index >= 0 ? index / types.length : 0.5;
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FeatureExtractor };
}

if (typeof window !== 'undefined') {
  window.adEclipseFeatureExtractor = new FeatureExtractor();
}
