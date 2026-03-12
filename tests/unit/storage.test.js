import { DEFAULT_SETTINGS, StorageManager } from '../../src/background/storage.js';
import { StatsTracker } from '../../src/background/stats.js';

describe('StorageManager', () => {
  let manager;

  beforeEach(() => {
    manager = new StorageManager();
  });

  test('returns sanitized defaults when storage is empty', async () => {
    chrome.storage.local.get.mockResolvedValue({});

    const settings = await manager.getSettings();

    expect(settings.enabled).toBe(true);
    expect(settings.mode).toBe(DEFAULT_SETTINGS.mode);
    expect(settings.enabledSites).toEqual([]);
  });

  test('migrates legacy site lists into explicit enabledSites', async () => {
    chrome.storage.local.get.mockResolvedValue({
      settings: {
        enabled: true,
        blacklist: ['https://www.youtube.com', 'ionmedia.tv'],
        whitelist: ['youtube.com']
      }
    });

    const settings = await manager.getSettings();

    expect(settings.enabledSites).toEqual(['ionmedia.tv']);
    expect(settings.whitelist).toBeUndefined();
    expect(settings.blacklist).toBeUndefined();
  });

  test('normalizes enabledSites during updates', async () => {
    chrome.storage.local.get.mockResolvedValue({ settings: DEFAULT_SETTINGS });

    await manager.updateSettings({
      enabledSites: ['https://www.YouTube.com/watch?v=abc', 'ionmedia.tv']
    });

    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      settings: expect.objectContaining({
        enabledSites: ['youtube.com', 'ionmedia.tv']
      })
    });
  });
});

describe('StatsTracker', () => {
  let tracker;

  beforeEach(() => {
    tracker = new StatsTracker();
  });

  test('returns the default stats shape', async () => {
    chrome.storage.local.get.mockResolvedValue({});

    const stats = await tracker.getStats();

    expect(stats.allTime.adsBlocked).toBe(0);
    expect(stats.today.adsBlocked).toBe(0);
    expect(stats.session.adsBlocked).toBe(0);
  });

  test('formats time and data for UI output', () => {
    expect(StatsTracker.formatTime(3661)).toBe('1h 1m');
    expect(StatsTracker.formatData(1536)).toBe('1.5 MB');
  });
});
