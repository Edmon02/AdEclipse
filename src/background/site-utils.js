export function normalizeHostname(input) {
  if (!input) return '';

  let value = String(input).trim().toLowerCase();
  if (!value) return '';

  try {
    if (value.startsWith('http://') || value.startsWith('https://')) {
      value = new URL(value).hostname;
    }
  } catch (_) {
    // Fall through to string normalization.
  }

  value = value
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split(':')[0]
    .trim()
    .replace(/\.+$/, '');

  return value;
}

export function normalizeHostnameList(list = []) {
  return [...new Set(
    (Array.isArray(list) ? list : [])
      .map(normalizeHostname)
      .filter(Boolean)
  )];
}

export function hostnameMatchesDomain(hostname, domain) {
  const normalizedHostname = normalizeHostname(hostname);
  const normalizedDomain = normalizeHostname(domain);

  if (!normalizedHostname || !normalizedDomain) {
    return false;
  }

  return (
    normalizedHostname === normalizedDomain ||
    normalizedHostname.endsWith(`.${normalizedDomain}`)
  );
}

export function listHasMatchingHostname(hostname, domains = []) {
  return normalizeHostnameList(domains).some((domain) =>
    hostnameMatchesDomain(hostname, domain)
  );
}

export function migrateEnabledSites(rawSettings = {}) {
  if (Array.isArray(rawSettings.enabledSites)) {
    return normalizeHostnameList(rawSettings.enabledSites);
  }

  const enabledFromLegacy = normalizeHostnameList(rawSettings.blacklist || []);
  const disabledLegacy = normalizeHostnameList(rawSettings.whitelist || []);

  return enabledFromLegacy.filter((domain) => !listHasMatchingHostname(domain, disabledLegacy));
}

export function isSiteEnabled(hostname, settings) {
  if (!settings?.enabled) {
    return false;
  }

  return listHasMatchingHostname(hostname, settings.enabledSites || []);
}
