// Background service worker — Maps Lead Scraper v2.0
// Side panel lifecycle + message forwarding

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url?.includes('google.com/maps')) {
    await chrome.sidePanel.open({ tabId: tab.id });
  } else {
    // Open Google Maps
    chrome.tabs.create({ url: 'https://www.google.com/maps' });
  }
});

// Enable side panel on Google Maps pages
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('google.com/maps')) {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'sidepanel.html',
      enabled: true
    });
  }
});

// Forward messages between content script and side panel
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Progress messages from content script are auto-forwarded to side panel
  // via chrome.runtime.onMessage (all listeners receive them)
  return true;
});

console.log('[Maps Lead Scraper] Background v2.0 loaded');
