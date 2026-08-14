// Background service worker — Maps Lead Scraper v3.4
// Side panel lifecycle + message forwarding
// Note: removed the dead onMessage listener that held message channels
// open (it returned true without ever calling sendResponse).

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (tab.url?.includes('google.com/maps')) {
      await chrome.sidePanel.open({ tabId: tab.id });
    } else {
      // Open Google Maps
      await chrome.tabs.create({ url: 'https://www.google.com/maps' });
    }
  } catch (e) {
    console.warn('[Maps Lead Scraper] action handler:', e);
  }
});

// Enable side panel on Google Maps pages
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('google.com/maps')) {
    try {
      await chrome.sidePanel.setOptions({
        tabId,
        path: 'sidepanel.html',
        enabled: true
      });
    } catch (e) {
      // tab may have been closed before the promise resolved
    }
  }
});

// Progress messages from content script are received directly by the
// side panel's own chrome.runtime.onMessage listener — nothing to relay.

console.log('[Maps Lead Scraper] Background v3.4 loaded');
