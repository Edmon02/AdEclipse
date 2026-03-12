const fs = require('fs');
const path = require('path');

describe('youtube resume regression', () => {
  const scriptPath = path.resolve(__dirname, '../../src/content/youtube.js');
  const scriptSource = fs.readFileSync(scriptPath, 'utf8');

  beforeEach(() => {
    jest.useFakeTimers();
    delete window.__ADECLIPSE_YT_LOADED__;
    document.body.innerHTML = `
      <div id="movie_player">
        <video></video>
      </div>
    `;

    window.requestAnimationFrame = jest.fn((callback) => setTimeout(callback, 16));
    window.cancelAnimationFrame = jest.fn((id) => clearTimeout(id));
    chrome.runtime.sendMessage = jest.fn((message, callback) => {
      if (callback) {
        callback({ enabled: true });
      }
      return Promise.resolve({ enabled: true });
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function loadScript(url) {
    window.history.pushState({}, '', url);

    const video = document.querySelector('video');
    video.play = jest.fn(() => Promise.resolve());
    video.pause = jest.fn();
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
    Object.defineProperty(video, 'paused', { configurable: true, writable: true, value: false });
    Object.defineProperty(video, 'currentSrc', { configurable: true, value: '' });

    window.eval(scriptSource);
    jest.advanceTimersByTime(600);

    return video;
  }

  test('restores the last known playback position after an ad ends', () => {
    const player = document.getElementById('movie_player');
    const video = loadScript('/watch?v=video123');

    Object.defineProperty(video, 'duration', { configurable: true, writable: true, value: 600 });
    video.currentTime = 120;
    video.dispatchEvent(new Event('timeupdate'));

    player.classList.add('ad-showing');
    Object.defineProperty(video, 'duration', { configurable: true, writable: true, value: 15 });
    video.currentTime = 0;
    jest.advanceTimersByTime(600);

    player.classList.remove('ad-showing');
    Object.defineProperty(video, 'duration', { configurable: true, writable: true, value: 600 });
    video.currentTime = 0;
    jest.advanceTimersByTime(600);
    video.dispatchEvent(new Event('loadeddata'));

    expect(video.currentTime).toBe(120);
  });

  test('uses the explicit URL timestamp instead of falling back to zero', () => {
    const player = document.getElementById('movie_player');
    const video = loadScript('/watch?v=video123&t=90');

    Object.defineProperty(video, 'duration', { configurable: true, writable: true, value: 15 });
    player.classList.add('ad-showing');
    video.currentTime = 0;
    jest.advanceTimersByTime(600);

    player.classList.remove('ad-showing');
    Object.defineProperty(video, 'duration', { configurable: true, writable: true, value: 600 });
    video.currentTime = 0;
    jest.advanceTimersByTime(600);
    video.dispatchEvent(new Event('loadeddata'));

    expect(video.currentTime).toBe(90);
  });
});
