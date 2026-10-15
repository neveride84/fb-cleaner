# Feed Cleaner for Facebook

A Chrome extension (Manifest V3) that hides the following on facebook.com:
- **Ads** – sponsored posts and the ad block in the right-hand column,
- **AI content** – posts labelled by Meta as AI ("AI info", "Made with AI", etc.) and Meta AI prompts,
- **Follow suggestions** – posts from Pages you don't follow (a "Follow" button in the post header),
- **Join suggestions** – posts from groups you're not a member of (a "Join" button in the post header),
- **Suggested / Reels** (optional) – "Suggested for you", Reels, "People you may know".

Each category can be switched on or off in the extension popup, which also shows how many items were hidden on the current page.

## Installation
1. Install from the Chrome Web Store, or for development: unpack the ZIP (or use the project folder directly).
2. Go to `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the extension folder.
4. Refresh Facebook.

After changing any file, click the reload icon next to Feed Cleaner in `chrome://extensions` and refresh the Facebook tab.

## How it works
- A `MutationObserver` plus a scroll listener (throttled to 250 ms) catch posts that Facebook loads dynamically.
- Posts are found inside the feed (`role="feed"`), as `role="article"` / `aria-posinset` elements, and – for layouts without those – by walking up from the post header to the container that also holds the Like button.
- A detected element gets a `data-fbclean` attribute listing its categories (`ad`, `ai`, `follow`, `join`, `suggested`, space-separated), and CSS hides it with `display:none`. A post stays hidden as long as at least one of its categories is switched on.
- The "Sponsored" label is often obfuscated (hidden letters, reordered spans, text rendered via SVG). The script checks `/ads/about` links, `aria-label`, `aria-labelledby` and `<use href>`, and reconstructs the text that is actually visible on screen.
- Posts are re-checked for about 15 seconds and again when they scroll into view, because Facebook adds labels with a delay.

## Preview mode
Instead of hiding detected items, preview mode outlines them in red with a category label – useful for checking that nothing you want to see is being removed.

## Limitations
- Facebook changes its DOM structure regularly, so the heuristics may need updating.
- Only content that Meta has **labelled** as AI is detected. Unlabelled AI content can't be reliably recognised from the DOM alone.
- The label dictionaries cover English and Polish (plus a few other languages for "Sponsored"). Add phrases in `content.js` if needed.

## Disclaimer
Feed Cleaner is an independent project and is not affiliated with, endorsed by, or sponsored by Meta Platforms, Inc. Facebook is a trademark of Meta Platforms, Inc.
