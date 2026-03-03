# AdEclipse - Advanced Ad Blocker

<p align="center">
  <img src="icons/icon128.png" alt="AdEclipse Logo" width="128" height="128">
</p>

<p align="center">
  <strong>A powerful, privacy-focused ad blocking browser extension built with Manifest V3</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#building">Building</a> •
  <a href="#testing">Testing</a> •
  <a href="#customization">Customization</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## Features

### 🎯 Core Functionality
- **YouTube Ad Blocking**: Blocks video ads, overlays, banners, sponsored content, and skippable/non-skippable pre-rolls
- **Universal Blocking**: Works on all websites including news sites, social media, and sites with Google AdSense
- **500+ Ad Domains**: Comprehensive blocklist covering all major ad networks
- **DeclarativeNetRequest**: Uses Manifest V3's efficient network blocking API

### 🚀 Performance
- **< 50ms Overhead**: Optimized for minimal performance impact
- **Debounced Observers**: Smart MutationObserver implementation prevents CPU spikes
- **Memory Efficient**: Uses WeakSet for element tracking to prevent memory leaks

### 🔒 Privacy
- **No Data Collection**: All processing happens locally
- **No Telemetry**: No analytics, tracking pixels, or user profiling
- **Local-First Operation**: Blocking and detection run on-device (optional rule updates can be fetched when auto-update is enabled)
- **On-Device ML**: Optional TensorFlow.js-based ad detection runs entirely in your browser

### 📊 Features Overview

| Feature | Description |
|---------|-------------|
| Video Ad Blocking | Skips YouTube video ads automatically |
| Banner Ad Blocking | Removes banner ads across all sites |
| Popup Blocking | Prevents popup and overlay ads |
| Anti-Adblock Bypass | Defeats adblock detection scripts |
| Custom Rules | Add your own CSS selectors per site |
| Whitelist | Disable blocking on specific sites |
| Statistics | Track blocked ads and saved time |
| Dark Mode | Full dark theme support |
| Import/Export | Backup and restore settings |

---

## Installation

### Chrome Web Store (Recommended)
*Coming soon*

### Firefox Add-ons
*Coming soon*

### Manual Installation

#### Chrome / Chromium-based Browsers

1. Download or clone this repository:
   ```bash
   git clone https://github.com/yourusername/adeclipse.git
   cd adeclipse
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" (toggle in top-right corner)

4. Click "Load unpacked" and select the `AdEclipse` folder

5. The extension is now installed and active!

#### Firefox

1. Download or clone this repository

2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`

3. Click "Load Temporary Add-on"

4. Navigate to the `AdEclipse` folder and select `manifest.json`

> **Note**: Temporary add-ons in Firefox are removed when the browser closes. For permanent installation, the extension must be signed by Mozilla.

---

## Building

### Prerequisites

- Node.js 18+ and npm
- (Optional) A code editor like VS Code

### Development Setup

```bash
# Clone the repository
git clone https://github.com/Edmon02/adeclipse.git
cd adeclipse

# Install dependencies
npm install

# Run tests
npm test

# Watch mode for development
npm run test:watch
```

### Project Structure

```
AdEclipse/
├── manifest.json           # Extension manifest (MV3)
├── rules/
│   ├── ad-domains.json     # 500+ blocked ad domains
│   ├── declarative_rules.json  # Network blocking rules
│   └── site-selectors.json # Per-site CSS selectors
├── src/
│   ├── background/
│   │   ├── background.js   # Service worker
│   │   ├── storage.js      # Settings management
│   │   ├── stats.js        # Statistics tracking
│   │   └── rules.js        # Dynamic rules
│   ├── content/
│   │   ├── youtube.js      # YouTube-specific blocking
│   │   ├── youtube.css     # YouTube ad hiding styles
│   │   ├── general.js      # General site blocking
│   │   ├── general.css     # General ad hiding styles
│   │   └── anti-adblock.js # Adblock detection bypass
│   ├── popup/
│   │   ├── popup.html      # Popup interface
│   │   ├── popup.css       # Popup styles
│   │   └── popup.js        # Popup logic
│   ├── options/
│   │   ├── options.html    # Settings page
│   │   ├── options.css     # Settings styles
│   │   └── options.js      # Settings logic
│   └── ml/
│       ├── detector.js     # ML-based ad detection
│       └── features.js     # Feature extraction
├── icons/
│   └── *.png               # Extension icons
└── tests/
  ├── setup.js            # Jest setup
  └── unit/               # Unit tests
```

---

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch

# Run specific test file
npm test -- --testPathPattern=youtube
```

### Test Structure

```javascript
// Example test for ad detection
describe('YouTubeAdBlocker', () => {
  test('should detect video ads', () => {
    const adElement = createMockElement('.ytp-ad-module');
    expect(isVideoAd(adElement)).toBe(true);
  });

  test('should skip detected ads', async () => {
    const video = createMockVideo({ ad: true });
    await skipAd(video);
    expect(video.currentTime).toBe(video.duration);
  });
});
```

---

## Customization

### Adding Custom Selectors

1. Open the AdEclipse options page
2. Navigate to "Website Rules"
3. Add a domain and CSS selector:
   - Domain: `example.com`
   - Selector: `.custom-ad-class, #ad-container`
4. The rule is applied immediately

### Whitelisting Sites

1. Click the AdEclipse icon in your toolbar
2. Toggle "Disable on this site"
3. Or add sites manually in Options → Website Rules → Whitelist

### Extending for New Sites

Create a new content script or add selectors to `rules/site-selectors.json`:

```json
{
  "example.com": {
    "selectors": {
      "banner": [".site-specific-ad", "[data-ad-slot]"],
      "sidebar": ["#right-rail-ads"],
      "native": [".sponsored-post"]
    },
    "aggressive": false
  }
}
```

---

## Configuration Options

### Blocking Modes

| Mode | Description |
|------|-------------|
| Balanced | Recommended default with performance optimization |
| Aggressive | Maximum blocking, may affect some content |
| Light | Essential ads only, less intrusive |

### YouTube Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Auto-skip | On | Automatically skip skippable ads |
| Skip/End Ad Handling | On | Seeks ad playback to end and triggers skip when available |
| Mute | On | Mute ads during playback |
| Overlay Cleanup | On | Removes YouTube ad overlays and promoted UI elements |

### Performance Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Observer debounce | 100ms | MutationObserver throttling |
| Performance mode | Off | Reduces observation frequency |
| ML detection | Off | Enable TensorFlow.js detection |

---

## API Reference

### Background Script Messages

```javascript
// Get current settings
const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });

// Update settings
await chrome.runtime.sendMessage({
  type: 'UPDATE_SETTINGS',
  data: { enabled: true, mode: 'balanced' }
});

// Get statistics
const stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
console.log(`Blocked today: ${stats.today.adsBlocked}`);

// Record blocked ad
await chrome.runtime.sendMessage({
  type: 'INCREMENT_BLOCKED',
  data: { type: 'videoAd', domain: 'youtube.com' }
});
```

### Content Script API

```javascript
// Get site state for current page
const siteState = await chrome.runtime.sendMessage({
  type: 'GET_SITE_ENABLED'
});

// Request selectors for hostname
const selectors = await chrome.runtime.sendMessage({
  type: 'GET_SELECTORS',
  data: { hostname: window.location.hostname }
});
```

---

## Troubleshooting

### Ads Still Appearing?

1. Make sure AdEclipse is enabled (check the popup)
2. Check if the site is whitelisted
3. Try switching to "Aggressive" mode
4. Add custom selectors for the specific ads

### Performance Issues?

1. Enable "Performance Mode" in settings
2. Increase the observer debounce value
3. Disable ML detection if enabled

### Extension Not Working?

1. Check for error messages in the browser console
2. Try reloading the extension
3. Clear browser cache and reload the page
4. Check for conflicts with other extensions

---

## Browser Compatibility

| Browser | Version | Status |
|---------|---------|--------|
| Chrome | 111+ | ✅ Full support |
| Edge | 111+ | ✅ Full support |
| Firefox | 109+ | ✅ Full support |
| Brave | Latest | ✅ Full support |
| Opera | 97+ | ✅ Full support |
| Safari | - | ❌ Not supported |

---

## Contributing

We welcome contributions! Here's how to get started:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Run tests: `npm test`
5. Commit your changes: `git commit -m 'Add amazing feature'`
6. Push to the branch: `git push origin feature/amazing-feature`
7. Open a Pull Request

### Development Guidelines

- Follow the existing code style
- Add tests for new features
- Update documentation as needed
- Keep commits atomic and well-described

---

## Privacy Policy

AdEclipse is committed to user privacy:

- **No data collection**: We don't collect any user data
- **No telemetry or tracking**: We don't profile users or collect browsing analytics
- **Local-first processing**: Blocking happens in-browser (rule updates may fetch from configured sources when enabled)
- **No tracking**: We don't track your browsing history
- **Open source**: Full transparency in how your data is handled

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Changelog

### v1.0.0 (Initial Release)
- YouTube video ad blocking
- General website ad blocking
- Anti-adblock bypass
- 500+ blocked ad domains
- Popup and options UI
- Statistics tracking
- Custom rules support
- Import/export settings
- Optional ML-based detection

---

## Acknowledgments

- Manifest V3 migration guidance from Google Chrome team
- Community filter lists for domain references
- TensorFlow.js for ML capabilities

---

<p align="center">
  Made with ❤️ for a better web experience
</p>
