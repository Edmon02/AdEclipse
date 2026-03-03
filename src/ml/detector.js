/**
 * AdEclipse ML Detection Module
 * Optional TensorFlow.js-based ad detection
 * Uses on-device classification for enhanced privacy
 */

class MLAdDetector {
  constructor() {
    this.model = null;
    this.isLoaded = false;
    this.isEnabled = false;
    this.labels = ['ad', 'content'];
    this.threshold = 0.7;
    this.cache = new Map();
    this.maxCacheSize = 500;
    this.debugMode = false;
  }

  /**
   * Initialize the ML detector
   */
  async init(options = {}) {
    this.isEnabled = options.enabled ?? true;
    this.threshold = options.threshold ?? 0.7;
    this.debugMode = options.debug ?? false;

    if (!this.isEnabled) {
      this.log('ML detection disabled');
      return false;
    }

    try {
      // Check if TensorFlow.js is available
      if (typeof tf === 'undefined') {
        this.log('TensorFlow.js not loaded');
        return false;
      }

      // Load the pre-trained model
      await this.loadModel();
      return this.isLoaded;
    } catch (error) {
      console.error('[AdEclipse ML] Init error:', error);
      return false;
    }
  }

  /**
   * Load the ML model
   */
  async loadModel() {
    try {
      // Try to load from IndexedDB cache first
      const cachedModel = await this.loadFromCache();
      if (cachedModel) {
        this.model = cachedModel;
        this.isLoaded = true;
        this.log('Model loaded from cache');
        return;
      }

      // Create a simple model for ad classification
      // In production, this would load a pre-trained model
      this.model = this.createModel();
      this.isLoaded = true;
      this.log('Model created');

      // Save to cache
      await this.saveToCache();
    } catch (error) {
      console.error('[AdEclipse ML] Model load error:', error);
      this.isLoaded = false;
    }
  }

  /**
   * Create a simple classification model
   * This is a placeholder - in production, load a pre-trained model
   */
  createModel() {
    const model = tf.sequential();

    // Input layer for feature vector
    model.add(tf.layers.dense({
      inputShape: [20],
      units: 64,
      activation: 'relu'
    }));

    model.add(tf.layers.dropout({ rate: 0.3 }));

    model.add(tf.layers.dense({
      units: 32,
      activation: 'relu'
    }));

    model.add(tf.layers.dense({
      units: 2,
      activation: 'softmax'
    }));

    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy']
    });

    return model;
  }

  /**
   * Extract features from a DOM element
   */
  extractFeatures(element) {
    const features = [];

    // Size features
    const rect = element.getBoundingClientRect();
    features.push(rect.width / window.innerWidth); // Normalized width
    features.push(rect.height / window.innerHeight); // Normalized height
    features.push((rect.width * rect.height) / (window.innerWidth * window.innerHeight)); // Area ratio
    features.push(rect.width / (rect.height || 1)); // Aspect ratio

    // Position features
    features.push(rect.top / window.innerHeight); // Normalized top position
    features.push(rect.left / window.innerWidth); // Normalized left position
    features.push(rect.bottom > window.innerHeight ? 1 : 0); // Below fold

    // Style features
    const style = window.getComputedStyle(element);
    features.push(style.position === 'fixed' || style.position === 'sticky' ? 1 : 0);
    features.push(style.zIndex !== 'auto' && parseInt(style.zIndex) > 1000 ? 1 : 0);
    features.push(parseFloat(style.opacity) < 1 ? 1 : 0);

    // Content features
    const text = element.textContent || '';
    const hasAdKeywords = /sponsored|advertisement|ad|promo|partner/i.test(text);
    features.push(hasAdKeywords ? 1 : 0);

    // Attribute features
    const classes = element.className || '';
    const id = element.id || '';
    const attrs = classes + ' ' + id;
    features.push(/ad|ads|advert|banner|sponsor|promo/i.test(attrs) ? 1 : 0);

    // Structure features
    features.push(element.querySelectorAll('iframe').length > 0 ? 1 : 0);
    features.push(element.querySelectorAll('img').length > 0 ? 1 : 0);
    features.push(element.querySelectorAll('a[target="_blank"]').length > 0 ? 1 : 0);
    features.push(element.querySelectorAll('script').length > 0 ? 1 : 0);

    // Link features
    const links = element.querySelectorAll('a');
    const externalLinks = Array.from(links).filter(a => 
      a.href && !a.href.includes(window.location.hostname)
    ).length;
    features.push(externalLinks / (links.length || 1));

    // Children count (normalized)
    features.push(Math.min(element.children.length / 50, 1));

    // Visibility
    features.push(rect.width > 0 && rect.height > 0 ? 1 : 0);

    return features;
  }

  /**
   * Predict if an element is an ad
   */
  async predict(element) {
    if (!this.isLoaded || !this.model) {
      return { isAd: false, confidence: 0 };
    }

    try {
      // Check cache
      const cacheKey = this.getCacheKey(element);
      if (this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }

      // Extract features
      const features = this.extractFeatures(element);

      // Make prediction
      const tensor = tf.tensor2d([features]);
      const prediction = this.model.predict(tensor);
      const probabilities = await prediction.data();
      
      // Cleanup tensors
      tensor.dispose();
      prediction.dispose();

      const adProbability = probabilities[0];
      const isAd = adProbability >= this.threshold;
      const result = {
        isAd,
        confidence: isAd ? adProbability : probabilities[1],
        probabilities: {
          ad: adProbability,
          content: probabilities[1]
        }
      };

      // Cache result
      this.cacheResult(cacheKey, result);

      this.log(`Prediction: ${isAd ? 'AD' : 'Content'} (${(adProbability * 100).toFixed(1)}%)`);
      return result;
    } catch (error) {
      console.error('[AdEclipse ML] Prediction error:', error);
      return { isAd: false, confidence: 0 };
    }
  }

  /**
   * Batch predict multiple elements
   */
  async predictBatch(elements) {
    if (!this.isLoaded || !this.model || elements.length === 0) {
      return elements.map(() => ({ isAd: false, confidence: 0 }));
    }

    try {
      const features = elements.map(el => this.extractFeatures(el));
      const tensor = tf.tensor2d(features);
      const predictions = this.model.predict(tensor);
      const data = await predictions.data();
      
      tensor.dispose();
      predictions.dispose();

      const results = [];
      for (let i = 0; i < elements.length; i++) {
        const adProb = data[i * 2];
        const contentProb = data[i * 2 + 1];
        results.push({
          isAd: adProb >= this.threshold,
          confidence: adProb >= this.threshold ? adProb : contentProb,
          probabilities: { ad: adProb, content: contentProb }
        });
      }

      return results;
    } catch (error) {
      console.error('[AdEclipse ML] Batch prediction error:', error);
      return elements.map(() => ({ isAd: false, confidence: 0 }));
    }
  }

  /**
   * Generate cache key for element
   */
  getCacheKey(element) {
    const rect = element.getBoundingClientRect();
    return `${element.tagName}_${element.className}_${Math.round(rect.width)}_${Math.round(rect.height)}`;
  }

  /**
   * Cache prediction result
   */
  cacheResult(key, result) {
    if (this.cache.size >= this.maxCacheSize) {
      // Remove oldest entries
      const keysToDelete = Array.from(this.cache.keys()).slice(0, 100);
      keysToDelete.forEach(k => this.cache.delete(k));
    }
    this.cache.set(key, result);
  }

  /**
   * Load model from IndexedDB cache
   */
  async loadFromCache() {
    try {
      const model = await tf.loadLayersModel('indexeddb://adeclipse-ml-model');
      return model;
    } catch (error) {
      return null;
    }
  }

  /**
   * Save model to IndexedDB cache
   */
  async saveToCache() {
    try {
      if (this.model) {
        await this.model.save('indexeddb://adeclipse-ml-model');
      }
    } catch (error) {
      console.error('[AdEclipse ML] Cache save error:', error);
    }
  }

  /**
   * Update model with new training data
   * This allows the model to improve based on user feedback
   */
  async updateModel(element, label) {
    if (!this.isLoaded || !this.model) return;

    try {
      const features = this.extractFeatures(element);
      const x = tf.tensor2d([features]);
      const y = tf.tensor2d([[label === 'ad' ? 1 : 0, label === 'ad' ? 0 : 1]]);

      await this.model.fit(x, y, {
        epochs: 1,
        verbose: 0
      });

      x.dispose();
      y.dispose();

      // Clear cache to reflect updated model
      this.cache.clear();

      // Save updated model
      await this.saveToCache();

      this.log('Model updated with feedback');
    } catch (error) {
      console.error('[AdEclipse ML] Model update error:', error);
    }
  }

  /**
   * Get model info
   */
  getInfo() {
    return {
      isLoaded: this.isLoaded,
      isEnabled: this.isEnabled,
      threshold: this.threshold,
      cacheSize: this.cache.size,
      tfVersion: typeof tf !== 'undefined' ? tf.version.tfjs : 'not loaded'
    };
  }

  /**
   * Cleanup resources
   */
  dispose() {
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
    this.cache.clear();
    this.isLoaded = false;
  }

  /**
   * Debug logging
   */
  log(...args) {
    if (this.debugMode) {
      console.log('[AdEclipse ML]', ...args);
    }
  }
}

// Singleton instance
const mlDetector = new MLAdDetector();

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MLAdDetector, mlDetector };
}

// Content script integration
if (typeof window !== 'undefined') {
  window.adEclipseML = mlDetector;
}
