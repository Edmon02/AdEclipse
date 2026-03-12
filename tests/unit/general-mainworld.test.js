const fs = require('fs');
const path = require('path');

describe('general main-world popup guard', () => {
  const scriptPath = path.resolve(__dirname, '../../src/content/general-mainworld.js');
  const scriptSource = fs.readFileSync(scriptPath, 'utf8');

  beforeEach(() => {
    document.body.innerHTML = '';
    delete window.__ADECLIPSE_GENERAL_MAINWORLD__;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function loadScript() {
    window.eval(scriptSource);
  }

  function dispatchTrustedPointerDown(target) {
    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    event.__adeclipseTrusted = true;
    target.dispatchEvent(event);
  }

  test('blocks popup attempts without a recent trusted gesture', () => {
    const originalOpen = jest.fn(() => 'opened');
    window.open = originalOpen;

    loadScript();

    expect(window.open('about:blank')).toBeNull();
    expect(originalOpen).not.toHaveBeenCalled();
  });

  test('allows a popup that matches the clicked anchor target', () => {
    const anchor = document.createElement('a');
    anchor.href = 'https://example.com/out';
    document.body.appendChild(anchor);

    const originalOpen = jest.fn(() => 'opened');
    window.open = originalOpen;

    loadScript();
    dispatchTrustedPointerDown(anchor);

    expect(window.open(anchor.href)).toBe('opened');
    expect(originalOpen).toHaveBeenCalledWith(anchor.href);
  });

  test('blocks delayed popup attempts after the gesture window expires', () => {
    const anchor = document.createElement('a');
    anchor.href = 'https://example.com/out';
    document.body.appendChild(anchor);

    const originalOpen = jest.fn(() => 'opened');
    window.open = originalOpen;

    loadScript();
    dispatchTrustedPointerDown(anchor);
    jest.advanceTimersByTime(2000);

    expect(window.open(anchor.href)).toBeNull();
    expect(originalOpen).not.toHaveBeenCalled();
  });
});
