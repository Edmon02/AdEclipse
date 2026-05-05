const { buildYouTubeSessionRules, YOUTUBE_SESSION_RULE_BASE_ID } = require('../../src/background/youtube-session-rules.js');

describe('buildYouTubeSessionRules', () => {
  const youtubeDomainConfig = {
    sessionRuleGroups: {
      telemetry: [
        {
          urlFilter: '||youtube.com/api/stats/ads',
          resourceTypes: ['xmlhttprequest', 'ping'],
          priority: 6,
          settingGate: 'trackers'
        }
      ],
      playerAds: [
        {
          urlFilter: '||youtube.com/pagead/',
          resourceTypes: ['xmlhttprequest'],
          priority: 7,
          settingGate: 'sponsoredContent'
        }
      ]
    }
  };

  test('builds session rules for enabled YouTube settings', () => {
    const rules = buildYouTubeSessionRules({
      enabled: true,
      youtube: { enabled: true, blockSponsored: true },
      blockTypes: { trackers: true, sponsoredContent: true },
      whitelist: []
    }, youtubeDomainConfig);

    expect(rules).toHaveLength(2);
    expect(rules[0].id).toBe(YOUTUBE_SESSION_RULE_BASE_ID);
    expect(rules[0].condition.initiatorDomains).toEqual(['youtube.com']);
  });

  test('respects setting gates and whitelist exclusions', () => {
    const gatedRules = buildYouTubeSessionRules({
      enabled: true,
      youtube: { enabled: true, blockSponsored: false },
      blockTypes: { trackers: true, sponsoredContent: true },
      whitelist: []
    }, youtubeDomainConfig);

    expect(gatedRules).toHaveLength(1);
    expect(gatedRules[0].condition.urlFilter).toBe('||youtube.com/api/stats/ads');

    const whitelistedRules = buildYouTubeSessionRules({
      enabled: true,
      youtube: { enabled: true, blockSponsored: true },
      blockTypes: { trackers: true, sponsoredContent: true },
      whitelist: ['www.youtube.com']
    }, youtubeDomainConfig);

    expect(whitelistedRules).toEqual([]);
  });
});