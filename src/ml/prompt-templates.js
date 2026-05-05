/**
 * AdEclipse AI Prompt Templates
 * Structured prompts for LLM-based ad detection
 */

const SYSTEM_PROMPT = `You are an expert ad detection system for a browser extension called AdEclipse. You analyze DOM element metadata from web pages and determine which elements are advertisements.

## Your Task
Given a list of DOM elements described by their metadata (tag, classes, IDs, text, dimensions, structure), classify each as an ad or legitimate content.

## What Counts as an Ad
- Display ads (Google AdSense, banner ads, rectangle ads, leaderboard ads)
- Sponsored/promoted posts or content
- Video advertisements (pre-roll, mid-roll, overlay)
- Affiliate marketing widgets and links
- Ad-network content (Taboola, Outbrain, RevContent, MGID, etc.)
- Newsletter/subscription overlays that block content
- Interstitial ads and full-page overlays
- Native ads disguised as content but served by ad networks
- "Recommended" or "Around the web" widgets from ad networks
- Shopping/product recommendation ads
- Social media promoted/boosted posts
- Tracking pixels and invisible ad containers
- Pop-under and pop-up ad containers

## What is NOT an Ad
- The site's own navigation, header, footer, sidebar menus
- Genuine content: articles, posts, comments, user-generated content
- The site's own product listings or recommendations (not from ad networks)
- Essential UI: login forms, search bars, settings panels
- Social sharing buttons (native, not promoted)
- Legitimate embedded videos (YouTube player for actual content)
- Cookie consent banners (unless they are deceptive overlay ads)
- Site announcements or notification bars from the site itself

## Response Format
Respond with ONLY a valid JSON array. Each element in the array corresponds to one input element (same order). Each object must have:
- "id": the element's identifier from the input
- "isAd": boolean
- "confidence": number 0.0-1.0
- "adType": string (one of: "display", "sponsored", "video", "native", "overlay", "affiliate", "tracking", "widget", "none")
- "reason": brief explanation (max 15 words)

Respond ONLY with the JSON array, no markdown fences, no commentary.`;

function buildUserPrompt(domain, elements) {
  const header = `Website: ${domain}\nElements to analyze (${elements.length} total):\n`;

  const elementDescriptions = elements.map((el, i) => {
    const lines = [`[Element ${el.id || i}]`];
    lines.push(`  Tag: <${el.tag}>`);

    if (el.id) lines.push(`  ID: "${el.id}"`);
    if (el.classes && el.classes.length) lines.push(`  Classes: ${el.classes.join(', ')}`);
    if (el.text) lines.push(`  Text: "${el.text}"`);

    lines.push(`  Size: ${el.width}x${el.height}px`);
    if (el.position) lines.push(`  Position: ${el.position}`);

    if (el.childTags && el.childTags.length) lines.push(`  Children: ${el.childTags.join(', ')}`);
    if (el.hasIframe) lines.push(`  Contains: iframe`);
    if (el.hasVideo) lines.push(`  Contains: video`);
    if (el.hasImage) lines.push(`  Contains: image`);

    if (el.linkCount) lines.push(`  Links: ${el.linkCount} (${el.externalLinkCount || 0} external)`);
    if (el.dataAttributes && el.dataAttributes.length) {
      lines.push(`  Data attrs: ${el.dataAttributes.slice(0, 5).join(', ')}`);
    }
    if (el.ariaLabel) lines.push(`  Aria-label: "${el.ariaLabel}"`);
    if (el.role) lines.push(`  Role: "${el.role}"`);
    if (el.src) lines.push(`  Src: "${el.src}"`);

    return lines.join('\n');
  });

  return header + elementDescriptions.join('\n\n');
}

const FEW_SHOT_EXAMPLES = [
  {
    role: 'user',
    content: `Website: news.example.com
Elements to analyze (3 total):

[Element el_0]
  Tag: <div>
  Classes: ad-container, google-ad
  Size: 728x90px
  Position: top
  Contains: iframe
  Data attrs: data-ad-slot="1234567890"

[Element el_1]
  Tag: <article>
  Classes: post-content, article-body
  Text: "Scientists discover new species in the deep ocean..."
  Size: 800x1200px
  Children: p, p, figure, p, p
  Links: 3 (0 external)

[Element el_2]
  Tag: <div>
  Classes: taboola-widget, recommended-content
  Text: "You May Also Like - Sponsored"
  Size: 600x400px
  Children: div, div, div, div
  Links: 8 (8 external)
  Data attrs: data-mode="alternating-thumbnails"`
  },
  {
    role: 'assistant',
    content: `[{"id":"el_0","isAd":true,"confidence":0.98,"adType":"display","reason":"Google AdSense banner ad container with iframe"},{"id":"el_1","isAd":false,"confidence":0.95,"adType":"none","reason":"Main article content with internal links"},{"id":"el_2","isAd":true,"confidence":0.96,"adType":"widget","reason":"Taboola sponsored content widget"}]`
  }
];

function buildMessages(domain, elements, includeExamples = true) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT }
  ];

  if (includeExamples) {
    messages.push(...FEW_SHOT_EXAMPLES);
  }

  messages.push({
    role: 'user',
    content: buildUserPrompt(domain, elements)
  });

  return messages;
}

export { SYSTEM_PROMPT, buildUserPrompt, buildMessages, FEW_SHOT_EXAMPLES };
