const DIAGNOSTICS_KEY = 'adeclipse_youtube_diagnostics';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeString(value, maxLength = 120) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function sanitizeUrl(value) {
  if (!value) return null;

  try {
    const parsed = new URL(value);
    return parsed.origin + parsed.pathname;
  } catch (_) {
    return sanitizeString(value, 160) || null;
  }
}

function sanitizeValue(value, depth) {
  if (depth > 2 || value == null) return undefined;

  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 6)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }

  if (!isPlainObject(value)) {
    return sanitizeString(value, 80);
  }

  const output = {};

  Object.entries(value)
    .slice(0, 8)
    .forEach(([key, nestedValue]) => {
      const normalizedKey = sanitizeString(key, 40);
      const sanitized = normalizedKey.toLowerCase().includes('url')
        ? sanitizeUrl(nestedValue)
        : sanitizeValue(nestedValue, depth + 1);

      if (sanitized !== undefined && sanitized !== null && sanitized !== '') {
        output[normalizedKey] = sanitized;
      }
    });

  return Object.keys(output).length ? output : undefined;
}

function createSummary() {
  return {
    totalCaptured: 0,
    byType: {},
    bySource: {}
  };
}

export class YouTubeDiagnosticsManager {
  constructor() {
    this.entries = [];
    this.summary = createSummary();
    this.enabled = false;
    this.maxEntries = 120;
    this.recentKeys = new Map();
    this.persistTimer = null;
  }

  async init(settings) {
    await this.load();
    this.configure(settings);
  }

  configure(settings) {
    this.enabled = Boolean(settings?.debugMode || settings?.youtube?.diagnosticsEnabled);
    this.maxEntries = settings?.youtube?.diagnosticsMaxEntries || 120;
    this.trimEntries();
  }

  async load() {
    try {
      const result = await chrome.storage.local.get(DIAGNOSTICS_KEY);
      const snapshot = result[DIAGNOSTICS_KEY] || {};
      this.entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
      this.summary = isPlainObject(snapshot.summary) ? snapshot.summary : createSummary();
      this.trimEntries();
    } catch (error) {
      console.error('[YouTubeDiagnostics] Load error:', error);
      this.entries = [];
      this.summary = createSummary();
    }
  }

  trimEntries() {
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(0, this.maxEntries);
    }
  }

  shouldCapture() {
    return this.enabled;
  }

  sanitizeEntry(entry) {
    if (!isPlainObject(entry)) return null;

    const normalized = {
      id: 'ytd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      timestamp: new Date().toISOString(),
      source: sanitizeString(entry.source || 'unknown', 40),
      type: sanitizeString(entry.type || 'event', 60),
      signal: sanitizeString(entry.signal || '', 80),
      pageType: sanitizeString(entry.pageType || '', 40) || null,
      url: sanitizeUrl(entry.url),
      tabId: Number.isInteger(entry.tabId) ? entry.tabId : null,
      request: sanitizeValue(entry.request, 0),
      details: sanitizeValue(entry.details, 0)
    };

    return normalized;
  }

  buildDedupeKey(entry) {
    const detailKey = entry.details ? JSON.stringify(entry.details).slice(0, 160) : '';
    return [entry.source, entry.type, entry.signal, entry.pageType, entry.url, detailKey].join('|');
  }

  schedulePersist() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }

    this.persistTimer = setTimeout(() => {
      this.persist().catch((error) => {
        console.error('[YouTubeDiagnostics] Persist error:', error);
      });
    }, 250);
  }

  async persist() {
    await chrome.storage.local.set({
      [DIAGNOSTICS_KEY]: {
        summary: this.summary,
        entries: this.entries
      }
    });
  }

  record(entry) {
    if (!this.shouldCapture()) {
      return { captured: false };
    }

    const sanitized = this.sanitizeEntry(entry);
    if (!sanitized) {
      return { captured: false };
    }

    const dedupeKey = this.buildDedupeKey(sanitized);
    const now = Date.now();
    const previous = this.recentKeys.get(dedupeKey) || 0;

    if (now - previous < 15000) {
      return { captured: false, deduped: true };
    }

    this.recentKeys.set(dedupeKey, now);
    this.entries.unshift(sanitized);
    this.trimEntries();

    this.summary.totalCaptured += 1;
    this.summary.byType[sanitized.type] = (this.summary.byType[sanitized.type] || 0) + 1;
    this.summary.bySource[sanitized.source] = (this.summary.bySource[sanitized.source] || 0) + 1;

    this.schedulePersist();
    return { captured: true, entry: sanitized };
  }

  recordRuleMatch(info) {
    const url = info?.request?.url || '';
    const initiator = info?.request?.initiator || '';

    if (!/youtube\.com|googlevideo\.com|ytimg\.com/i.test(url + ' ' + initiator)) {
      return { captured: false };
    }

    return this.record({
      source: 'dnr',
      type: 'rule-match',
      signal: String(info?.rule?.ruleId || ''),
      url,
      tabId: info?.request?.tabId,
      request: {
        url,
        initiator,
        type: info?.request?.type,
        method: info?.request?.method
      },
      details: {
        rulesetId: info?.rule?.rulesetId || null,
        frameType: info?.request?.frameType || null
      }
    });
  }

  getSnapshot(limit = 50) {
    return {
      enabled: this.enabled,
      summary: this.summary,
      totalEntries: this.entries.length,
      entries: this.entries.slice(0, limit)
    };
  }

  async exportSnapshot(limit = this.maxEntries) {
    return {
      exportedAt: new Date().toISOString(),
      version: chrome.runtime.getManifest().version,
      diagnostics: this.getSnapshot(limit)
    };
  }

  async clear() {
    this.entries = [];
    this.summary = createSummary();
    this.recentKeys.clear();
    await this.persist();
  }
}