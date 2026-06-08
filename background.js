// Background service worker — Maps Lead Scraper v1.0

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Forward messages between popup and content script
  if (msg.type === 'SCROLL_PROGRESS' || msg.type === 'DETAILS_PROGRESS') {
    // These are sent from content script, popup listens via chrome.runtime.onMessage
  }
  return true;
});

console.log('[Maps Lead Scraper] Background v1.0 loaded');
