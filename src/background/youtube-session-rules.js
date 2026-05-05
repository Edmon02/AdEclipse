export const YOUTUBE_SESSION_RULE_BASE_ID = 20000;

function youtubeIsWhitelisted(settings) {
  const whitelist = settings?.whitelist || [];
  return whitelist.some((hostname) => hostname === 'youtube.com' || hostname.endsWith('.youtube.com'));
}

function isEnabledBySetting(settings, gate) {
  switch (gate) {
    case 'videoAds':
      return settings?.blockTypes?.videoAds !== false;
    case 'sponsoredContent':
      return settings?.blockTypes?.sponsoredContent !== false && settings?.youtube?.blockSponsored !== false;
    case 'trackers':
      return settings?.blockTypes?.trackers !== false;
    default:
      return true;
  }
}

function normalizeRuleTemplate(groupName, template, index) {
  return {
    id: YOUTUBE_SESSION_RULE_BASE_ID + index,
    groupName,
    priority: template.priority || 4,
    resourceTypes: template.resourceTypes || ['xmlhttprequest'],
    urlFilter: template.urlFilter || null,
    regexFilter: template.regexFilter || null,
    initiatorDomains: template.initiatorDomains || ['youtube.com'],
    requestDomains: template.requestDomains,
    requestMethods: template.requestMethods,
    settingGate: template.settingGate || null
  };
}

export function buildYouTubeSessionRules(settings, youtubeDomainConfig = {}) {
  if (!settings?.enabled || settings?.youtube?.enabled === false || youtubeIsWhitelisted(settings)) {
    return [];
  }

  const sessionRuleGroups = youtubeDomainConfig.sessionRuleGroups || {};
  const rules = [];
  let index = 0;

  Object.entries(sessionRuleGroups).forEach(([groupName, templates]) => {
    const list = Array.isArray(templates) ? templates : [];

    list.forEach((template) => {
      const normalized = normalizeRuleTemplate(groupName, template, index);
      index += 1;

      if (normalized.settingGate && !isEnabledBySetting(settings, normalized.settingGate)) {
        return;
      }

      const condition = {
        resourceTypes: normalized.resourceTypes,
        initiatorDomains: normalized.initiatorDomains
      };

      if (normalized.requestDomains) {
        condition.requestDomains = normalized.requestDomains;
      }

      if (normalized.requestMethods) {
        condition.requestMethods = normalized.requestMethods;
      }

      if (normalized.regexFilter) {
        condition.regexFilter = normalized.regexFilter;
      } else if (normalized.urlFilter) {
        condition.urlFilter = normalized.urlFilter;
      } else {
        return;
      }

      rules.push({
        id: normalized.id,
        priority: normalized.priority,
        action: { type: 'block' },
        condition
      });
    });
  });

  return rules;
}