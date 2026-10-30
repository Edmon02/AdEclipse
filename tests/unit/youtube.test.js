/**
 * YouTube Ad Blocker Unit Tests
 * Exercises the real content scripts and background registration.
 */

const fs = require('fs');
const path = require('path');
const { URL: NodeURL } = require('url');
import { buildYouTubeScripts, youtubeTabActive } from '../../src/background/youtube-scripts.js';

const MAIN_WORLD_SRC = fs.readFileSync(
  path.join(__dirname, '../../src/content/youtube-mainworld.js'), 'utf8'
);
const ISOLATED_SRC = fs.readFileSync(
  path.join(__dirname, '../../src/content/youtube.js'), 'utf8'
);

const realURL = global.URL;
beforeAll(() => { global.URL = NodeURL; });
afterAll(() => { global.URL = realURL; });

/* ── Main world ─────────────────────────────────────────────── */

class FakeHeaders {
  constructor(init) {
    this.map = new Map();
    if (init instanceof FakeHeaders) init.map.forEach((v, k) => this.map.set(k, v));
    else if (init) Object.entries(init).forEach(([k, v]) => this.map.set(k.toLowerCase(), v));
  }
  get(k) { return this.map.has(k.toLowerCase()) ? this.map.get(k.toLowerCase()) : null; }
  delete(k) { this.map.delete(k.toLowerCase()); }
}

class FakeResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.statusText = init.statusText ?? 'OK';
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = init.headers instanceof FakeHeaders ? init.headers : new FakeHeaders(init.headers);
  }
  clone() { return new FakeResponse(this.body, this); }
  json() { return Promise.resolve(JSON.parse(this.body)); }
}

function makeXhrClass() {
  class FakeXHR {
    open() {}
    get readyState() { return 4; }
    get responseText() { return this._raw; }
    get response() { return this._raw; }
  }
  return FakeXHR;
}

function loadMainWorld({ fetchImpl, initialPlayerResponse } = {}) {
  const win = {
    fetch: fetchImpl,
    JSON: { parse: JSON.parse, stringify: JSON.stringify },
    Object: { assign: Object.assign }
  };
  if (initialPlayerResponse) win.ytInitialPlayerResponse = initialPlayerResponse;
  const XHR = makeXhrClass();
  const loc = { href: 'https://www.youtube.com/watch?v=abc', pathname: '/watch' };
  const run = new Function('window', 'location', 'XMLHttpRequest', 'Headers', 'Response', MAIN_WORLD_SRC);
  run(win, loc, XHR, FakeHeaders, FakeResponse);
  return { win, XHR, location: loc };
}

const playerPayload = () => ({
  videoDetails: { videoId: 'abc', title: 'Real video' },
  adPlacements: [{ adPlacementRenderer: {} }],
  playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
  adSlots: [{}],
  streamingData: { formats: [{ itag: 18 }] }
});

const jsonResponse = (obj) => new FakeResponse(JSON.stringify(obj), {
  headers: { 'content-type': 'application/json; charset=UTF-8' }
});

describe('youtube-mainworld.js', () => {
  test('strips ad pods from the player response and keeps the video', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(jsonResponse(playerPayload())));
    const { win } = loadMainWorld({ fetchImpl });

    const res = await win.fetch('/youtubei/v1/player?key=x', {});
    const json = await res.json();

    expect(json.adPlacements).toBeUndefined();
    expect(json.playerAds).toBeUndefined();
    expect(json.adSlots).toBeUndefined();
    expect(json.videoDetails).toEqual({ videoId: 'abc', title: 'Real video' });
    expect(json.streamingData.formats).toHaveLength(1);
    expect(res.status).toBe(200);
  });

  test('cleans get_watch, ad_break, next and reel responses', async () => {
    for (const url of [
      '/youtubei/v1/get_watch?prettyPrint=false',
      'https://www.youtube.com/youtubei/v1/player/ad_break',
      '/youtubei/v1/next',
      '/youtubei/v1/reel/reel_watch_sequence'
    ]) {
      const fetchImpl = jest.fn(() => Promise.resolve(jsonResponse(playerPayload())));
      const { win } = loadMainWorld({ fetchImpl });
      const json = await (await win.fetch(url)).json();
      expect(json.adPlacements).toBeUndefined();
    }
  });

  test('cleans player responses nested inside a get_watch array', async () => {
    const payload = [{ playerResponse: playerPayload() }, { response: { contents: [] } }];
    const { win } = loadMainWorld({ fetchImpl: () => Promise.resolve(jsonResponse(payload)) });
    const json = await (await win.fetch('/youtubei/v1/get_watch')).json();
    expect(json[0].playerResponse.adPlacements).toBeUndefined();
    expect(json[0].playerResponse.videoDetails.videoId).toBe('abc');
  });

  test('filters ad renderer items out of next contents', async () => {
    const payload = {
      contents: [
        { compactVideoRenderer: { videoId: 'a' } },
        { adSlotRenderer: {} },
        { compactVideoRenderer: { videoId: 'b' } }
      ]
    };
    const fetchImpl = jest.fn(() => Promise.resolve(jsonResponse(payload)));
    const { win } = loadMainWorld({ fetchImpl });
    const json = await (await win.fetch('/youtubei/v1/next')).json();
    expect(json.contents.map(c => c.compactVideoRenderer.videoId)).toEqual(['a', 'b']);
  });

  test('does not traverse browse responses', async () => {
    const original = jsonResponse(playerPayload());
    const fetchImpl = jest.fn(() => Promise.resolve(original));
    const { win } = loadMainWorld({ fetchImpl });
    const res = await win.fetch('/youtubei/v1/browse');
    expect(res).toBe(original);
  });

  test('returns the original response when nothing was removed', async () => {
    const original = jsonResponse({ videoDetails: { videoId: 'abc' } });
    const { win } = loadMainWorld({ fetchImpl: () => Promise.resolve(original) });
    expect(await win.fetch('/youtubei/v1/player')).toBe(original);
  });

  test('cleans ytInitialPlayerResponse both preset and assigned later', () => {
    const { win } = loadMainWorld({ fetchImpl: jest.fn(), initialPlayerResponse: playerPayload() });
    expect(win.ytInitialPlayerResponse.adPlacements).toBeUndefined();

    win.ytInitialPlayerResponse = playerPayload();
    expect(win.ytInitialPlayerResponse.playerAds).toBeUndefined();
    expect(win.ytInitialPlayerResponse.videoDetails.videoId).toBe('abc');
  });

  test('cleans XHR responseText for target URLs only, without tagging the request', () => {
    const { XHR } = loadMainWorld({ fetchImpl: jest.fn() });

    const target = new XHR();
    target.open('POST', '/youtubei/v1/player');
    target._raw = JSON.stringify(playerPayload());
    expect(JSON.parse(target.responseText).adPlacements).toBeUndefined();
    expect(Object.keys(target)).toEqual(['_raw']);

    const other = new XHR();
    other.open('POST', '/youtubei/v1/browse');
    other._raw = JSON.stringify(playerPayload());
    expect(JSON.parse(other.responseText).adPlacements).toHaveLength(1);
  });

  test('asks player requests for a stream with no ad, without changing the original object', () => {
    const { win } = loadMainWorld({ fetchImpl: jest.fn() });
    const request = { videoId: 'abc', playbackContext: { contentPlaybackContext: { vis: 0 } } };

    const text = win.JSON.stringify(request);
    expect(text).toContain('"isInlinePlaybackNoAd":true');
    expect(request.playbackContext.contentPlaybackContext.isInlinePlaybackNoAd).toBeUndefined();
    expect(win.JSON.stringify({ videoId: 'abc' })).toBe('{"videoId":"abc"}');
    expect(win.JSON.stringify.toString()).toBe(Function.prototype.toString.call(JSON.stringify));
  });

  test('marks a request body built with Object.assign or passed to fetch', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(jsonResponse({ videoDetails: { videoId: 'abc' } })));
    const { win } = loadMainWorld({ fetchImpl });
    const raw = '{"playbackContext":{"contentPlaybackContext":{}}}';

    const init = win.Object.assign({ method: 'POST' }, { body: raw });
    expect(init.body).toContain('"isInlinePlaybackNoAd":true');
    expect(raw).not.toContain('isInlinePlaybackNoAd');

    await win.fetch('/youtubei/v1/player', { method: 'POST', body: raw });
    expect(fetchImpl.mock.calls[0][1].body).toContain('"isInlinePlaybackNoAd":true');
    expect(fetchImpl.mock.calls[0][1].method).toBe('POST');
  });

  test('wrapped fetch reports native source and original name', () => {
    const fetchImpl = function fetch() {};
    const { win } = loadMainWorld({ fetchImpl });
    expect(win.fetch.name).toBe('fetch');
    expect(win.fetch.toString()).toBe(Function.prototype.toString.call(fetchImpl));
  });

  test('caps traversal depth on pathological payloads', async () => {
    const nest = (depth, leaf) => {
      let node = leaf;
      for (let i = 0; i < depth; i++) node = { child: node };
      return node;
    };
    const payload = { shallow: nest(10, { adPlacements: [1] }), deep: nest(300, { adPlacements: [1] }) };
    const { win } = loadMainWorld({ fetchImpl: () => Promise.resolve(jsonResponse(payload)) });
    const json = await (await win.fetch('/youtubei/v1/player')).json();

    let shallow = json.shallow;
    for (let i = 0; i < 10; i++) shallow = shallow.child;
    let deep = json.deep;
    for (let i = 0; i < 300; i++) deep = deep.child;
    expect(shallow.adPlacements).toBeUndefined();
    expect(deep.adPlacements).toEqual([1]);
  });

  test('leaves no extension fingerprints in page-visible source', () => {
    expect(MAIN_WORLD_SRC).not.toMatch(/__ADECLIPSE_|__adeclipseUrl|_adeclipse_url/);
    expect(MAIN_WORLD_SRC).not.toMatch(/setInterval/);
  });

  test('starts a player left paused after the opening wait', () => {
    document.body.innerHTML = `
      <div id="movie_player" class="html5-video-player paused-mode unstarted-mode">
        <video></video>
      </div>
    `;
    const player = document.getElementById('movie_player');
    const video = player.querySelector('video');
    Object.defineProperty(video, 'paused', { get: () => true, configurable: true });
    Object.defineProperty(video, 'duration', { get: () => 600, configurable: true });
    Object.defineProperty(video, 'currentTime', { get: () => 0, configurable: true });
    player.playVideo = jest.fn();

    loadMainWorld({ fetchImpl: jest.fn() });

    expect(player.playVideo).toHaveBeenCalled();
    document.body.innerHTML = '';
  });

  test('stops playback when the viewer leaves the watch page', () => {
    document.body.innerHTML = `
      <div id="movie_player" class="html5-video-player playing-mode">
        <video></video>
      </div>
    `;
    const player = document.getElementById('movie_player');
    const video = player.querySelector('video');
    let paused = false;
    Object.defineProperty(video, 'paused', { get: () => paused, configurable: true });
    player.playVideo = jest.fn();
    player.pauseVideo = jest.fn(() => { paused = true; });
    const { location } = loadMainWorld({ fetchImpl: jest.fn() });
    player.playVideo.mockClear();

    location.pathname = '/';
    location.href = 'https://www.youtube.com/';
    window.dispatchEvent(new Event('yt-navigate-finish'));

    expect(player.pauseVideo).toHaveBeenCalled();
    expect(player.playVideo).not.toHaveBeenCalled();
    document.body.innerHTML = '';
  });

  test('pauses the previous video when a Short starts and does not start it again', () => {
    document.body.innerHTML = `
      <div id="movie_player" class="html5-video-player playing-mode">
        <video></video>
      </div>
    `;
    const player = document.getElementById('movie_player');
    const video = player.querySelector('video');
    let paused = false;
    Object.defineProperty(video, 'paused', { get: () => paused, configurable: true });
    Object.defineProperty(video, 'currentTime', { get: () => 20, configurable: true });
    video.pause = jest.fn();
    player.playVideo = jest.fn();
    player.pauseVideo = jest.fn(() => { paused = true; });
    const { location } = loadMainWorld({ fetchImpl: jest.fn() });
    player.playVideo.mockClear();
    player.pauseVideo.mockClear();

    location.pathname = '/shorts/abc';
    location.href = 'https://www.youtube.com/shorts/abc';
    window.dispatchEvent(new Event('yt-navigate-finish'));

    expect(player.pauseVideo).toHaveBeenCalled();
    expect(player.playVideo).not.toHaveBeenCalled();

    player.pauseVideo.mockClear();
    paused = false;
    video.dispatchEvent(new Event('play'));
    expect(player.pauseVideo).toHaveBeenCalled();
    expect(player.playVideo).not.toHaveBeenCalled();
    document.body.innerHTML = '';
  });

  test('does not resume a video that Chrome media controls paused', () => {
    document.body.innerHTML = `
      <div id="movie_player" class="html5-video-player playing-mode">
        <video></video>
      </div>
    `;
    const player = document.getElementById('movie_player');
    const video = player.querySelector('video');
    Object.defineProperty(video, 'paused', { get: () => false, configurable: true });
    Object.defineProperty(video, 'duration', { get: () => 600, configurable: true });
    Object.defineProperty(video, 'currentTime', { get: () => 12, configurable: true });
    player.playVideo = jest.fn();

    loadMainWorld({ fetchImpl: jest.fn() });
    video.dispatchEvent(new Event('pause'));

    expect(player.playVideo).not.toHaveBeenCalled();
    document.body.innerHTML = '';
  });

  test('releases page hooks when the extension is turned off', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(jsonResponse(playerPayload())));
    const { win } = loadMainWorld({ fetchImpl });
    expect(win.fetch).not.toBe(fetchImpl);

    document.dispatchEvent(new CustomEvent('yt-player-ctl', { detail: 'release' }));

    expect(win.fetch).toBe(fetchImpl);
    expect(win.JSON.stringify).toBe(JSON.stringify);
    expect(win.Object.assign).toBe(Object.assign);
    const json = await (await win.fetch('/youtubei/v1/player')).json();
    expect(json.adPlacements).toHaveLength(1);
  });

  test('lets go of the page when the extension stops answering', () => {
    jest.useFakeTimers();
    try {
      document.body.innerHTML = '';
      const fetchImpl = jest.fn(() => Promise.resolve(jsonResponse(playerPayload())));
      const win = {
        fetch: fetchImpl,
        JSON: { parse: JSON.parse, stringify: JSON.stringify },
        Object: { assign: Object.assign }
      };
      const loc = { href: 'https://www.youtube.com/watch?v=abc', pathname: '/watch' };
      const run = new Function(
        'window', 'location', 'XMLHttpRequest', 'Headers', 'Response', 'chrome',
        MAIN_WORLD_SRC
      );
      run(win, loc, makeXhrClass(), FakeHeaders, FakeResponse, undefined);
      expect(win.fetch).not.toBe(fetchImpl);
      jest.advanceTimersByTime(7000);
      expect(win.fetch).toBe(fetchImpl);
    } finally {
      jest.useRealTimers();
    }
  });

  test('leaves the player paused when the viewer paused it', () => {
    document.body.innerHTML = `
      <div id="movie_player" class="html5-video-player playing-mode">
        <video></video>
        <button class="ytp-play-button"></button>
      </div>
    `;
    const player = document.getElementById('movie_player');
    const video = player.querySelector('video');
    let paused = false;
    Object.defineProperty(video, 'paused', { get: () => paused, configurable: true });
    Object.defineProperty(video, 'duration', { get: () => 600, configurable: true });
    Object.defineProperty(video, 'currentTime', { get: () => 12, configurable: true });
    player.playVideo = jest.fn();

    loadMainWorld({ fetchImpl: jest.fn() });
    player.playVideo.mockClear();

    player.querySelector('.ytp-play-button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    paused = true;
    video.dispatchEvent(new Event('pause'));

    expect(player.playVideo).not.toHaveBeenCalled();
    document.body.innerHTML = '';
  });

  test('closes the ad-block wall, removes the dim backdrop, and unlocks scroll', () => {
    document.body.innerHTML = `
      <ytd-popup-container>
        <tp-yt-paper-dialog class="opened" opened>
          <ytd-enforcement-message-view-model></ytd-enforcement-message-view-model>
        </tp-yt-paper-dialog>
      </ytd-popup-container>
      <tp-yt-iron-overlay-backdrop class="opened" opened></tp-yt-iron-overlay-backdrop>
    `;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('no-scroll');
    const dialog = document.querySelector('tp-yt-paper-dialog');
    dialog.close = jest.fn();

    loadMainWorld({ fetchImpl: jest.fn() });

    expect(dialog.close).toHaveBeenCalled();
    expect(document.querySelector('ytd-enforcement-message-view-model')).toBeNull();
    expect(document.querySelector('tp-yt-iron-overlay-backdrop')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(document.body.classList.contains('no-scroll')).toBe(false);
    document.body.innerHTML = '';
  });
});

/* ── Isolated world fallback ─────────────────────────────────── */

describe('youtube.js fallback', () => {
  let observers;
  let video;
  let player;

  beforeEach(() => {
    observers = [];
    global.MutationObserver = class {
      constructor(cb) { this.cb = cb; this.targets = []; observers.push(this); }
      observe(target, opts) { this.targets.push({ target, opts }); }
      disconnect() { this.targets = []; }
    };

    document.body.innerHTML = `
      <ytd-popup-container></ytd-popup-container>
      <div id="movie_player"><video></video><button class="ytp-ad-skip-button"></button></div>
    `;
    player = document.getElementById('movie_player');
    video = player.querySelector('video');
    let t = 0;
    Object.defineProperty(video, 'duration', { value: 15, configurable: true, writable: true });
    Object.defineProperty(video, 'currentTime', { get: () => t, set: v => { t = v; }, configurable: true });
    Object.defineProperty(video, 'paused', { value: false, configurable: true, writable: true });
    video.play = jest.fn(() => Promise.resolve());
    video.muted = false;
  });

  afterEach(() => {
    document.dispatchEvent(new CustomEvent('yt-player-ctl', { detail: 'release' }));
    document.body.innerHTML = '';
  });

  const run = () => new Function(ISOLATED_SRC)();
  const fireClass = () => observers[0].cb([{ type: 'attributes' }]);

  test('creates no timers and watches only player class and popup container', () => {
    const intervalSpy = jest.spyOn(global, 'setInterval');
    const rafSpy = jest.spyOn(global, 'requestAnimationFrame');
    run();
    expect(intervalSpy).not.toHaveBeenCalled();
    expect(rafSpy).not.toHaveBeenCalled();
    expect(observers).toHaveLength(1);
    expect(observers[0].targets.map(t => t.target)).toEqual([
      player,
      document.querySelector('ytd-popup-container'),
      document.body
    ]);
    expect(observers[0].targets[0].opts).toEqual({ attributes: true, attributeFilter: ['class'] });
    intervalSpy.mockRestore();
    rafSpy.mockRestore();
  });

  test('mutes, seeks the ad to its end and clicks skip, then restores audio', () => {
    const skip = player.querySelector('.ytp-ad-skip-button');
    skip.click = jest.fn();
    run();

    player.classList.add('ad-showing');
    fireClass();
    expect(video.muted).toBe(true);
    expect(video.currentTime).toBe(15);
    expect(skip.click).toHaveBeenCalled();
    expect(video.playbackRate).toBe(1);

    player.classList.remove('ad-showing');
    fireClass();
    expect(video.muted).toBe(false);
  });

  test('seeks each ad in a pod when its metadata loads', () => {
    run();
    player.classList.add('ad-showing');
    fireClass();

    video.duration = 20;
    video.currentTime = 0;
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(video.currentTime).toBe(20);
  });

  test('rewinds the real video when the ad seek parked it at the end', () => {
    run();
    video.currentTime = 42;
    player.classList.add('ad-showing');
    fireClass();
    player.classList.remove('ad-showing');
    fireClass();

    video.duration = 600;
    video.currentTime = 600;
    video.dispatchEvent(new Event('playing'));
    expect(video.currentTime).toBe(42);
  });

  test('tells the page to let go when the extension is gone', () => {
    jest.useFakeTimers();
    const seen = [];
    const onCtl = (event) => seen.push(event.detail);
    document.addEventListener('yt-player-ctl', onCtl);
    try {
      run();
      chrome.runtime.id = '';
      jest.advanceTimersByTime(1600);
      expect(seen).toContain('release');
      player.classList.add('ad-showing');
      fireClass();
      expect(video.muted).toBe(false);
    } finally {
      chrome.runtime.id = 'test-extension-id';
      document.removeEventListener('yt-player-ctl', onCtl);
      jest.useRealTimers();
    }
  });

  test('does not add page-visible globals or style elements', () => {
    run();
    expect(Object.keys(window).filter(k => /adeclipse/i.test(k))).toEqual([]);
    expect(document.querySelectorAll('style')).toHaveLength(0);
    expect(ISOLATED_SRC).not.toMatch(/setInterval|requestAnimationFrame|adeclipse-/);
  });
});

/* ── Background registration ─────────────────────────────────── */

describe('buildYouTubeScripts', () => {
  test('registers main-world and isolated scripts at document_start in the top frame', () => {
    const scripts = buildYouTubeScripts({ enabled: true, whitelist: [], youtube: { enabled: true } });
    expect(scripts.map(s => s.id)).toEqual(['yt-main', 'yt-isolated']);
    scripts.forEach(s => {
      expect(s.runAt).toBe('document_start');
      expect(s.allFrames).toBe(false);
      expect(s.excludeMatches).toBeUndefined();
    });
    expect(scripts[0].world).toBe('MAIN');
    expect(scripts[1].css).toEqual(['src/content/youtube.css']);
  });

  test('registers nothing when disabled globally or for YouTube', () => {
    expect(buildYouTubeScripts({ enabled: false, whitelist: [] })).toEqual([]);
    expect(buildYouTubeScripts({ enabled: true, whitelist: [], youtube: { enabled: false } })).toEqual([]);
  });

  test('treats only an enabled, non-whitelisted YouTube tab as active', () => {
    const on = { enabled: true, whitelist: [], youtube: { enabled: true } };
    expect(youtubeTabActive(on, 'https://www.youtube.com/watch?v=abc')).toBe(true);
    expect(youtubeTabActive(on, 'https://m.youtube.com/shorts/abc')).toBe(true);
    expect(youtubeTabActive({ ...on, enabled: false }, 'https://www.youtube.com/')).toBe(false);
    expect(youtubeTabActive({ ...on, youtube: { enabled: false } }, 'https://www.youtube.com/')).toBe(false);
    expect(youtubeTabActive(
      { ...on, whitelist: ['www.youtube.com'] },
      'https://www.youtube.com/watch?v=abc'
    )).toBe(false);
    expect(youtubeTabActive(
      { ...on, whitelist: ['example.com'] },
      'https://www.youtube.com/watch?v=abc'
    )).toBe(true);
    expect(youtubeTabActive(on, 'not a url')).toBe(false);
  });

  test('excludes whitelisted YouTube hosts and ignores other or malformed entries', () => {
    const [main] = buildYouTubeScripts({
      enabled: true,
      whitelist: ['www.youtube.com', 'example.com', 'bad host/*', 'notyoutube.com']
    });
    expect(main.excludeMatches).toEqual(['*://www.youtube.com/*']);
  });
});

describe('manifest', () => {
  test('does not expose content scripts as web-accessible resources', () => {
    const manifest = require('../../manifest.json');
    expect(manifest.web_accessible_resources).toBeUndefined();
  });
});
