const { YouTubeDiagnosticsManager } = require('../../src/background/youtube-diagnostics.js');
const { URL: NodeURL } = require('url');

describe('YouTubeDiagnosticsManager', () => {
  let manager;
  let OriginalURL;

  beforeEach(() => {
    jest.clearAllMocks();
    chrome.storage.local.get.mockResolvedValue({});
    chrome.storage.local.set.mockResolvedValue();
    OriginalURL = global.URL;
    global.URL = class {
      constructor(url) {
        const parsed = new NodeURL(url);
        this.origin = parsed.origin;
        this.pathname = parsed.pathname;
      }
    };
    manager = new YouTubeDiagnosticsManager();
  });

  afterEach(() => {
    global.URL = OriginalURL;
  });

  test('captures sanitized diagnostic entries when enabled', async () => {
    await manager.init({ youtube: { diagnosticsEnabled: true, diagnosticsMaxEntries: 10 } });

    const result = manager.record({
      source: 'youtube-mainworld',
      type: 'sanitizer-unknown-keys',
      url: 'https://www.youtube.com/watch?v=abc123&list=secret',
      details: {
        key: 'newAdRenderer',
        requestUrl: 'https://www.youtube.com/youtubei/v1/player?foo=bar'
      }
    });

    expect(result.captured).toBe(true);
    expect(manager.getSnapshot(1).entries[0].url).toBe('https://www.youtube.com/watch');
    expect(manager.getSnapshot(1).entries[0].details.requestUrl).toBe('https://www.youtube.com/youtubei/v1/player');
  });

  test('deduplicates repeated events within the capture window', async () => {
    await manager.init({ youtube: { diagnosticsEnabled: true } });

    manager.record({ source: 'youtube', type: 'player-surface', signal: 'promo-overlay' });
    const second = manager.record({ source: 'youtube', type: 'player-surface', signal: 'promo-overlay' });

    expect(second.deduped).toBe(true);
    expect(manager.getSnapshot().totalEntries).toBe(1);
  });

  test('records YouTube rule matches and ignores unrelated requests', async () => {
    await manager.init({ debugMode: true, youtube: { diagnosticsEnabled: false } });

    manager.recordRuleMatch({
      rule: { ruleId: 77, rulesetId: '_session' },
      request: {
        url: 'https://www.youtube.com/pagead/test',
        initiator: 'https://www.youtube.com',
        type: 'xmlhttprequest',
        method: 'GET',
        tabId: 3
      }
    });

    manager.recordRuleMatch({
      rule: { ruleId: 78, rulesetId: '_session' },
      request: {
        url: 'https://example.com/file.js',
        initiator: 'https://example.com',
        type: 'script',
        method: 'GET',
        tabId: 3
      }
    });

    const snapshot = manager.getSnapshot();
    expect(snapshot.totalEntries).toBe(1);
    expect(snapshot.entries[0].type).toBe('rule-match');
  });
});