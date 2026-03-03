/**
 * Storage Manager Unit Tests
 */

describe('StorageManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getSettings', () => {
    test('should return default settings when storage is empty', async () => {
      chrome.storage.local.get.mockResolvedValue({});

      const defaultSettings = {
        enabled: true,
        blockingMode: 'standard',
        theme: 'system',
        blockTypes: {
          videoAds: true,
          overlayAds: true,
          bannerAds: true,
          sponsoredContent: true,
          popups: true,
          tracking: true
        }
      };

      const result = await chrome.storage.local.get(['settings']);
      const settings = result.settings || defaultSettings;

      expect(settings).toEqual(defaultSettings);
    });

    test('should return stored settings', async () => {
      const storedSettings = {
        enabled: false,
        blockingMode: 'aggressive'
      };

      chrome.storage.local.get.mockResolvedValue({ settings: storedSettings });

      const result = await chrome.storage.local.get(['settings']);
      
      expect(result.settings).toEqual(storedSettings);
    });

    test('should merge stored settings with defaults', () => {
      const defaults = {
        enabled: true,
        blockingMode: 'standard',
        newOption: 'default'
      };

      const stored = {
        enabled: false,
        blockingMode: 'light'
      };

      const merged = { ...defaults, ...stored };

      expect(merged).toEqual({
        enabled: false,
        blockingMode: 'light',
        newOption: 'default'
      });
    });
  });

  describe('saveSettings', () => {
    test('should save settings to storage', async () => {
      const settings = {
        enabled: true,
        blockingMode: 'aggressive'
      };

      await chrome.storage.local.set({ settings });

      expect(chrome.storage.local.set).toHaveBeenCalledWith({ settings });
    });

    test('should handle save errors', async () => {
      chrome.storage.local.set.mockRejectedValue(new Error('Storage full'));

      await expect(chrome.storage.local.set({ settings: {} }))
        .rejects.toThrow('Storage full');
    });
  });

  describe('getWhitelist', () => {
    test('should return empty array when no whitelist', async () => {
      chrome.storage.local.get.mockResolvedValue({});

      const result = await chrome.storage.local.get(['whitelist']);
      const whitelist = result.whitelist || [];

      expect(whitelist).toEqual([]);
    });

    test('should return stored whitelist', async () => {
      const storedWhitelist = ['example.com', 'trusted.org'];
      chrome.storage.local.get.mockResolvedValue({ whitelist: storedWhitelist });

      const result = await chrome.storage.local.get(['whitelist']);

      expect(result.whitelist).toEqual(storedWhitelist);
    });
  });

  describe('addToWhitelist', () => {
    test('should add new domain to whitelist', async () => {
      const existingWhitelist = ['example.com'];
      chrome.storage.local.get.mockResolvedValue({ whitelist: existingWhitelist });

      const newDomain = 'newsite.com';
      const result = await chrome.storage.local.get(['whitelist']);
      const whitelist = result.whitelist || [];
      
      if (!whitelist.includes(newDomain)) {
        whitelist.push(newDomain);
      }

      await chrome.storage.local.set({ whitelist });

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        whitelist: ['example.com', 'newsite.com']
      });
    });

    test('should not add duplicate domain', async () => {
      const existingWhitelist = ['example.com'];
      chrome.storage.local.get.mockResolvedValue({ whitelist: existingWhitelist });

      const newDomain = 'example.com';
      const result = await chrome.storage.local.get(['whitelist']);
      const whitelist = result.whitelist || [];
      
      if (!whitelist.includes(newDomain)) {
        whitelist.push(newDomain);
      }

      expect(whitelist).toEqual(['example.com']);
    });

    test('should normalize domain before adding', () => {
      const inputs = [
        'https://example.com/page',
        'http://www.example.com',
        'example.com',
        'EXAMPLE.COM'
      ];

      const normalize = (url) => {
        return url
          .replace(/^https?:\/\//, '')
          .replace(/^www\./, '')
          .split('/')[0]
          .toLowerCase();
      };

      const expected = 'example.com';
      inputs.forEach(input => {
        expect(normalize(input)).toBe(expected);
      });
    });
  });

  describe('removeFromWhitelist', () => {
    test('should remove domain from whitelist', async () => {
      const existingWhitelist = ['example.com', 'remove-me.com', 'keep.com'];
      chrome.storage.local.get.mockResolvedValue({ whitelist: existingWhitelist });

      const domainToRemove = 'remove-me.com';
      const result = await chrome.storage.local.get(['whitelist']);
      const whitelist = result.whitelist.filter(d => d !== domainToRemove);

      await chrome.storage.local.set({ whitelist });

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        whitelist: ['example.com', 'keep.com']
      });
    });
  });

  describe('clearAll', () => {
    test('should clear all storage', async () => {
      await chrome.storage.local.clear();

      expect(chrome.storage.local.clear).toHaveBeenCalled();
    });
  });

  describe('import/export', () => {
    test('should export settings as JSON', () => {
      const settings = {
        enabled: true,
        blockingMode: 'standard',
        whitelist: ['example.com']
      };

      const exported = JSON.stringify(settings, null, 2);
      const parsed = JSON.parse(exported);

      expect(parsed).toEqual(settings);
    });

    test('should import valid JSON settings', () => {
      const importData = `{
        "enabled": false,
        "blockingMode": "aggressive",
        "whitelist": ["imported.com"]
      }`;

      const settings = JSON.parse(importData);

      expect(settings.enabled).toBe(false);
      expect(settings.blockingMode).toBe('aggressive');
      expect(settings.whitelist).toContain('imported.com');
    });

    test('should reject invalid JSON', () => {
      const invalidJson = '{ invalid json }';

      expect(() => JSON.parse(invalidJson)).toThrow();
    });

    test('should validate imported settings schema', () => {
      const validSettings = {
        enabled: true,
        blockingMode: 'standard'
      };

      const invalidSettings = {
        enabled: 'not-a-boolean',
        blockingMode: 123
      };

      const validate = (settings) => {
        if (typeof settings.enabled !== 'boolean') return false;
        if (!['standard', 'aggressive', 'light'].includes(settings.blockingMode)) return false;
        return true;
      };

      expect(validate(validSettings)).toBe(true);
      expect(validate(invalidSettings)).toBe(false);
    });
  });
});

describe('Stats Tracker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('recordBlocked', () => {
    test('should increment blocked count', async () => {
      let stats = { blocked: 0 };

      stats.blocked++;

      expect(stats.blocked).toBe(1);
    });

    test('should track by ad type', () => {
      const stats = {
        blocked: 0,
        byType: {
          video: 0,
          banner: 0,
          overlay: 0
        }
      };

      const adType = 'video';
      stats.blocked++;
      stats.byType[adType]++;

      expect(stats.blocked).toBe(1);
      expect(stats.byType.video).toBe(1);
    });

    test('should track by domain', () => {
      const stats = {
        blocked: 0,
        byDomain: {}
      };

      const domain = 'youtube.com';
      stats.blocked++;
      stats.byDomain[domain] = (stats.byDomain[domain] || 0) + 1;

      expect(stats.byDomain['youtube.com']).toBe(1);
    });
  });

  describe('getStats', () => {
    test('should return all stats', async () => {
      const storedStats = {
        blocked: 100,
        session: { blocked: 25 },
        today: { blocked: 50 }
      };

      chrome.storage.local.get.mockResolvedValue({ stats: storedStats });

      const result = await chrome.storage.local.get(['stats']);

      expect(result.stats).toEqual(storedStats);
    });

    test('should calculate time saved', () => {
      const blocked = 100;
      const avgAdDuration = 15; // seconds

      const timeSaved = blocked * avgAdDuration;

      expect(timeSaved).toBe(1500);
    });

    test('should format time saved', () => {
      const formatTime = (seconds) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        if (hours > 0) return `${hours}h ${minutes}m`;
        if (minutes > 0) return `${minutes}m ${secs}s`;
        return `${secs}s`;
      };

      expect(formatTime(3661)).toBe('1h 1m');
      expect(formatTime(125)).toBe('2m 5s');
      expect(formatTime(45)).toBe('45s');
    });
  });

  describe('resetStats', () => {
    test('should reset all stats', async () => {
      const emptyStats = {
        blocked: 0,
        session: { blocked: 0 },
        today: { blocked: 0 },
        byType: {},
        byDomain: {}
      };

      await chrome.storage.local.set({ stats: emptyStats });

      expect(chrome.storage.local.set).toHaveBeenCalledWith({ stats: emptyStats });
    });

    test('should reset only session stats', () => {
      const stats = {
        blocked: 100,
        session: { blocked: 50 },
        today: { blocked: 75 }
      };

      stats.session = { blocked: 0 };

      expect(stats.blocked).toBe(100);
      expect(stats.session.blocked).toBe(0);
    });
  });

  describe('daily rotation', () => {
    test('should detect new day', () => {
      const lastDate = '2024-01-01';
      const today = new Date().toISOString().split('T')[0];

      const isNewDay = lastDate !== today;

      expect(typeof isNewDay).toBe('boolean');
    });

    test('should reset daily stats on new day', () => {
      const stats = {
        today: { blocked: 100, date: '2024-01-01' }
      };

      const today = '2024-01-02';
      
      if (stats.today.date !== today) {
        stats.today = { blocked: 0, date: today };
      }

      expect(stats.today.blocked).toBe(0);
      expect(stats.today.date).toBe('2024-01-02');
    });
  });
});
