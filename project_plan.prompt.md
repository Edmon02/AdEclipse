Build a complete, fully functional browser extension called 'AdEclipse' using Manifest V3 for Chrome and Firefox compatibility. The extension should primarily block all types of ads on YouTube (including video ads, overlay ads, banner ads, sponsored content, and skippable/non-skippable pre-rolls) by intercepting requests, mutating DOM elements, and using content scripts. Then, extend it to block ads on other websites, such as article-based sites like news portals (e.g., CNN, Reddit, or any site with embedded Google AdSense, banners, pop-ups, or interstitials).

Key requirements for sophistication and best user experience:
- **Core Functionality**:
  - Use declarativeNetRequest to block ad-related domains and URLs (e.g., googlevideo.com for YouTube ads, doubleclick.net, adservice.google.com for general ads). Include a comprehensive, updatable list of over 500 common ad domains, categorized by site type (YouTube-specific, general web).
  - Inject content scripts to dynamically detect and remove ad elements via CSS selectors, XPath, or mutation observers (e.g., hide '.ytp-ad-module' on YouTube, or '.ad-container' on generic sites). Use AI-like heuristics (simple regex or optional TensorFlow.js for pattern recognition) to identify and block evolving ad formats without hardcoding.
  - Handle YouTube specifics: Skip ads automatically if possible (simulate skip button clicks), mute during ads, or fast-forward. For other sites: Remove inline ads in articles, sidebars, pop-unders, and auto-playing videos.
  - Extensibility: Allow easy addition of new site rules via a JSON config file (e.g., users can add custom domains or selectors for sites like Twitter/X or blogs).

- **Advanced Features**:
  - **Machine Learning Integration**: Optionally integrate TensorFlow.js (load via CDN) for on-device ad classification – train a simple model (provide sample code) to detect ad images/text based on keywords, sizes, or positions, falling back to rule-based if disabled for performance.
  - **Performance Optimization**: Use lazy loading for scripts, debounce mutation observers to avoid CPU spikes, and cache blocked elements. Ensure the extension doesn't slow down page loads (target <50ms overhead).
  - **User Customization**: Include a popup UI with toggles for enabling/disabling per-site (whitelist/blacklist), ad types (e.g., video vs. banner), and modes (aggressive vs. light blocking). Add a stats dashboard showing blocked ads count, data saved, and time saved (e.g., 'Skipped 5 ads today, saving 2 minutes').
  - **Privacy and Security**: No data collection; all processing local. Handle edge cases like ad blockers detectors (anti-anti-adblock) by spoofing requests or injecting stealth scripts.
  - **UI/UX Polish**: Use modern web tech (HTML/CSS/JS with Tailwind CSS or Bootstrap for styling). Popup should be responsive, dark-mode compatible, with animations (e.g., fade-out for removed ads). Options page for advanced settings, import/export rules, and auto-updates from a GitHub repo (fetch JSON rules periodically).
  - **Error Handling and Logging**: Robust try-catch, console logging only in debug mode, and a report bug feature that sends anonymized logs to a placeholder email.
  - **Testing and Compatibility**: Provide unit tests (using Jest) for key functions like ad detection. Ensure it works on mobile browsers if possible. Handle updates to YouTube/web APIs by making selectors configurable.

Structure the project as a ZIP-ready folder with:
- manifest.json (V3 compliant, with permissions: declarativeNetRequest, storage, tabs, webRequest, etc.).
- background.js for request blocking and event handling.
- content.js for DOM manipulation.
- popup.html/js/css for the UI.
- options.html/js for settings.
- rules.json for ad domains/selectors (initially populated with YouTube and 10+ common sites like nytimes.com, forbes.com).
- Include a README.md with installation instructions, how to build/test, and how to extend for new sites.

Output the full code for all files, zipped structure description, and any setup commands (e.g., for loading in Chrome). Make it sophisticated, production-ready, and focused on delivering the smoothest ad-free experience without breaking site functionality.