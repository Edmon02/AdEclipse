/**
 * Jest Test Setup
 * Global mocks and configuration for tests
 */

// Mock Chrome Extension APIs
global.chrome = {
  runtime: {
    sendMessage: jest.fn((message, callback) => {
      if (callback) callback({});
      return Promise.resolve({});
    }),
    onMessage: {
      addListener: jest.fn()
    },
    getManifest: jest.fn(() => ({
      version: '1.0.0'
    })),
    id: 'test-extension-id'
  },
  storage: {
    local: {
      get: jest.fn((keys, callback) => {
        if (callback) callback({});
        return Promise.resolve({});
      }),
      set: jest.fn((items, callback) => {
        if (callback) callback();
        return Promise.resolve();
      }),
      remove: jest.fn((keys, callback) => {
        if (callback) callback();
        return Promise.resolve();
      }),
      clear: jest.fn((callback) => {
        if (callback) callback();
        return Promise.resolve();
      })
    },
    sync: {
      get: jest.fn((keys, callback) => {
        if (callback) callback({});
        return Promise.resolve({});
      }),
      set: jest.fn((items, callback) => {
        if (callback) callback();
        return Promise.resolve();
      })
    }
  },
  tabs: {
    query: jest.fn(() => Promise.resolve([])),
    sendMessage: jest.fn(() => Promise.resolve()),
    get: jest.fn(() => Promise.resolve({})),
    update: jest.fn(() => Promise.resolve({}))
  },
  action: {
    setBadgeText: jest.fn(() => Promise.resolve()),
    setBadgeBackgroundColor: jest.fn(() => Promise.resolve()),
    setIcon: jest.fn(() => Promise.resolve())
  },
  declarativeNetRequest: {
    updateDynamicRules: jest.fn(() => Promise.resolve()),
    getDynamicRules: jest.fn(() => Promise.resolve([]))
  },
  alarms: {
    create: jest.fn(),
    onAlarm: {
      addListener: jest.fn()
    },
    clear: jest.fn()
  }
};

// Mock MutationObserver
global.MutationObserver = class {
  constructor(callback) {
    this.callback = callback;
  }
  observe() {}
  disconnect() {}
  takeRecords() { return []; }
};

// Mock IntersectionObserver
global.IntersectionObserver = class {
  constructor(callback) {
    this.callback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock fetch
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve('')
  })
);

// Mock URL
global.URL = class {
  constructor(url, base) {
    this.href = url;
    this.hostname = 'example.com';
    this.pathname = '/';
    this.search = '';
    this.hash = '';
  }
};

// Console error handler for tests
const originalConsoleError = console.error;
console.error = (...args) => {
  // Suppress expected errors during tests
  if (args[0]?.includes?.('[AdEclipse]')) {
    return;
  }
  originalConsoleError.apply(console, args);
};

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});
