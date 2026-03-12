import {
  hostnameMatchesDomain,
  isSiteEnabled,
  migrateEnabledSites,
  normalizeHostname,
  normalizeHostnameList
} from '../../src/background/site-utils.js';

describe('site utils', () => {
  test('normalizes hostnames from URLs and strips www', () => {
    expect(normalizeHostname('https://www.YouTube.com/watch?v=TaW-98B31AE')).toBe('youtube.com');
    expect(normalizeHostname('ionmedia.tv/path')).toBe('ionmedia.tv');
  });

  test('normalizes and deduplicates enabled sites', () => {
    expect(normalizeHostnameList([
      'https://www.youtube.com',
      'youtube.com',
      'IONMEDIA.TV'
    ])).toEqual(['youtube.com', 'ionmedia.tv']);
  });

  test('matches exact domains and subdomains', () => {
    expect(hostnameMatchesDomain('m.youtube.com', 'youtube.com')).toBe(true);
    expect(hostnameMatchesDomain('example.com', 'youtube.com')).toBe(false);
  });

  test('migrates legacy blacklist into explicit enabled sites', () => {
    expect(migrateEnabledSites({
      blacklist: ['https://www.youtube.com', 'ionmedia.tv'],
      whitelist: ['youtube.com']
    })).toEqual(['ionmedia.tv']);
  });

  test('enables protection only on explicitly added sites', () => {
    expect(isSiteEnabled('www.youtube.com', {
      enabled: true,
      enabledSites: ['youtube.com']
    })).toBe(true);

    expect(isSiteEnabled('example.com', {
      enabled: true,
      enabledSites: ['youtube.com']
    })).toBe(false);

    expect(isSiteEnabled('youtube.com', {
      enabled: false,
      enabledSites: ['youtube.com']
    })).toBe(false);
  });
});
