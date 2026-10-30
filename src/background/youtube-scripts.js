/**
 * AdEclipse - YouTube content script registration
 * YouTube scripts run at document_start in the top frame so the main-world
 * hook is in place before YouTube's own scripts read ytInitialPlayerResponse.
 */

export const YT_SCRIPT_IDS = ['yt-main', 'yt-isolated'];

const HOSTNAME_RE = /^[a-z0-9.-]+$/i;

export function youtubeTabActive(settings, url) {
  if (!settings?.enabled || settings.youtube?.enabled === false) return false;
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch (e) {
    return false;
  }
  if (hostname !== 'youtube.com' && !hostname.endsWith('.youtube.com')) return false;
  return !(settings.whitelist || []).includes(hostname);
}

export function buildYouTubeScripts(settings) {
  if (!settings?.enabled || settings.youtube?.enabled === false) return [];

  const excludeMatches = (settings.whitelist || [])
    .filter(h => HOSTNAME_RE.test(h) && (h === 'youtube.com' || h.endsWith('.youtube.com')))
    .map(h => `*://${h}/*`);

  const base = {
    matches: ['*://*.youtube.com/*'],
    runAt: 'document_start',
    allFrames: false,
    persistAcrossSessions: true
  };
  if (excludeMatches.length) base.excludeMatches = excludeMatches;

  return [
    { ...base, id: 'yt-main', js: ['src/content/youtube-mainworld.js'], world: 'MAIN' },
    { ...base, id: 'yt-isolated', js: ['src/content/youtube.js'], css: ['src/content/youtube.css'] }
  ];
}
