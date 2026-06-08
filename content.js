// Maps Lead Scraper — Content Script v1.0
// Scrapes business listings from Google Maps search results

(() => {
  'use strict';

  // ─── State ─────────────────────────────────────────────────────────
  
  let isScraping = false;
  let scrapedLeads = [];
  let detailQueue = [];
  let isGettingDetails = false;

  // ─── Scrape Search Results (Sidebar Listings) ─────────────────────
  
  function scrapeSearchResults() {
    const leads = [];
    
    // Google Maps search results are in the sidebar
    // Each listing is a div with role="article" or a.Nv2PK
    const listings = document.querySelectorAll('a.Nv2PK, div[role="article"] a[href*="/maps/place"]');
    
    if (listings.length === 0) {
      // Try alternative selectors
      const altListings = document.querySelectorAll('.hfpxzc, [data-result-index]');
      if (altListings.length === 0) {
        return { error: 'No listings found. Try searching on Google Maps first.' };
      }
    }
    
    const processedNames = new Set();
    
    // Method 1: Parse from search result cards
    const cards = document.querySelectorAll('div.Nv2PK, div[jsaction*="mouseover"]');
    
    for (const card of cards) {
      try {
        const lead = extractFromCard(card);
        if (lead && lead.name && !processedNames.has(lead.name)) {
          processedNames.add(lead.name);
          leads.push(lead);
        }
      } catch (e) {}
    }
    
    // Method 2: Parse from the scrollable list
    if (leads.length === 0) {
      const scrollContainer = document.querySelector('[role="feed"], .m6QErb');
      if (scrollContainer) {
        const items = scrollContainer.querySelectorAll('a[href*="/maps/place"]');
        for (const item of items) {
          try {
            const lead = extractFromLink(item);
            if (lead && lead.name && !processedNames.has(lead.name)) {
              processedNames.add(lead.name);
              leads.push(lead);
            }
          } catch (e) {}
        }
      }
    }
    
    return { leads, total: leads.length };
  }

  function extractFromCard(card) {
    const lead = {
      name: '',
      category: '',
      rating: 0,
      reviews: 0,
      address: '',
      phone: '',
      website: '',
      email: '',
      hours: '',
      priceLevel: '',
      url: '',
      lat: 0,
      lng: 0
    };
    
    // Name
    const nameEl = card.querySelector('.qBF1Pd, .fontHeadlineSmall, [class*="qBF1Pd"], [class*="fontHeadlineSmall"]');
    if (nameEl) {
      lead.name = nameEl.textContent.trim();
    }
    
    // Category
    const categoryEl = card.querySelector('.W4Efsd span:not([class]), .W4Efsd .W4Efsd span');
    if (categoryEl) {
      const text = categoryEl.textContent.trim();
      if (text && !text.match(/^\d/) && !text.includes('·')) {
        lead.category = text;
      }
    }
    
    // Rating & Reviews
    const ratingEl = card.querySelector('.MW4etd, [class*="MW4etd"]');
    if (ratingEl) {
      lead.rating = parseFloat(ratingEl.textContent) || 0;
    }
    
    const reviewsEl = card.querySelector('.UY7F9, [class*="UY7F9"]');
    if (reviewsEl) {
      const reviewsText = reviewsEl.textContent.replace(/[()]/g, '').replace(/\./g, '');
      lead.reviews = parseInt(reviewsText) || 0;
    }
    
    // Address (from subtitle)
    const subtitleEls = card.querySelectorAll('.W4Efsd');
    for (const el of subtitleEls) {
      const text = el.textContent;
      if (text.includes('·')) {
        const parts = text.split('·').map(p => p.trim());
        for (const part of parts) {
          if (part.match(/\d/) && part.length > 5) {
            lead.address = part;
          }
        }
      }
    }
    
    // URL
    const link = card.closest('a') || card.querySelector('a[href*="/maps/place"]');
    if (link) {
      lead.url = link.href;
      // Extract coordinates from URL
      const coordMatch = link.href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
      if (coordMatch) {
        lead.lat = parseFloat(coordMatch[1]);
        lead.lng = parseFloat(coordMatch[2]);
      }
    }
    
    return lead;
  }

  function extractFromLink(link) {
    const lead = {
      name: '',
      category: '',
      rating: 0,
      reviews: 0,
      address: '',
      phone: '',
      website: '',
      email: '',
      hours: '',
      url: link.href,
      lat: 0,
      lng: 0
    };
    
    // Name
    const nameEl = link.querySelector('.qBF1Pd, .fontHeadlineSmall');
    if (nameEl) lead.name = nameEl.textContent.trim();
    
    // Rating
    const ratingEl = link.querySelector('.MW4etd');
    if (ratingEl) lead.rating = parseFloat(ratingEl.textContent) || 0;
    
    // Reviews
    const reviewsEl = link.querySelector('.UY7F9');
    if (reviewsEl) {
      lead.reviews = parseInt(reviewsEl.textContent.replace(/[().]/g, '')) || 0;
    }
    
    // Coordinates
    const coordMatch = link.href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (coordMatch) {
      lead.lat = parseFloat(coordMatch[1]);
      lead.lng = parseFloat(coordMatch[2]);
    }
    
    return lead;
  }

  // ─── Get Details for a Single Listing ──────────────────────────────
  
  async function getListingDetails(url) {
    return new Promise((resolve) => {
      // Navigate to the listing page
      const originalUrl = window.location.href;
      
      // Instead of navigating, try to extract from the current detail panel
      // Google Maps shows details in a side panel when you click a listing
      
      const detailPanel = document.querySelector('[role="main"], .m6QErb.DxyBCb');
      if (!detailPanel) {
        resolve({ error: 'No detail panel found' });
        return;
      }
      
      const lead = {
        name: '',
        category: '',
        rating: 0,
        reviews: 0,
        address: '',
        phone: '',
        website: '',
        email: '',
        hours: '',
        priceLevel: '',
        url: url || window.location.href
      };
      
      // Name
      const nameEl = detailPanel.querySelector('h1, .DUwDvf, [class*="DUwDvf"]');
      if (nameEl) lead.name = nameEl.textContent.trim();
      
      // Category
      const categoryEl = detailPanel.querySelector('button[jsaction*="category"], .DkEaL');
      if (categoryEl) lead.category = categoryEl.textContent.trim();
      
      // Rating
      const ratingEl = detailPanel.querySelector('.MW4etd, [class*="MW4etd"]');
      if (ratingEl) lead.rating = parseFloat(ratingEl.textContent) || 0;
      
      // Reviews
      const reviewsEl = detailPanel.querySelector('.UY7F9, [class*="UY7F9"]');
      if (reviewsEl) {
        lead.reviews = parseInt(reviewsEl.textContent.replace(/[().]/g, '').replace(/\./g, '')) || 0;
      }
      
      // Address
      const addressEl = detailPanel.querySelector('[data-item-id="address"] .Io6YTe, [data-item-id="address"] font');
      if (addressEl) lead.address = addressEl.textContent.trim();
      
      // Phone
      const phoneEl = detailPanel.querySelector('[data-item-id*="phone"] .Io6YTe, [data-item-id*="phone"] font');
      if (phoneEl) lead.phone = phoneEl.textContent.trim();
      
      // Website
      const websiteEl = detailPanel.querySelector('[data-item-id="authority"] .Io6YTe, [data-item-id="authority"] font, a[data-item-id="authority"]');
      if (websiteEl) lead.website = websiteEl.textContent.trim() || websiteEl.href || '';
      
      // Hours
      const hoursEl = detailPanel.querySelector('[data-item-id*="hours"] .Io6YTe, [aria-label*="hours"]');
      if (hoursEl) lead.hours = hoursEl.textContent.trim();
      
      // Price level
      const priceEl = detailPanel.querySelector('.mgr77e, [class*="mgr77e"]');
      if (priceEl) lead.priceLevel = priceEl.textContent.trim();
      
      resolve(lead);
    });
  }

  // ─── Auto-scroll to load more results ──────────────────────────────
  
  async function autoScroll(maxScrolls = 20) {
    const scrollContainer = document.querySelector('[role="feed"], .m6QErb.DxyBCb.kA9KIf');
    if (!scrollContainer) return 0;
    
    let scrollCount = 0;
    let lastHeight = 0;
    
    while (scrollCount < maxScrolls) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
      await new Promise(r => setTimeout(r, 1500));
      
      const newHeight = scrollContainer.scrollHeight;
      if (newHeight === lastHeight) break;
      
      lastHeight = newHeight;
      scrollCount++;
      
      // Report progress
      chrome.runtime.sendMessage({
        type: 'SCROLL_PROGRESS',
        scroll: scrollCount,
        max: maxScrolls
      }).catch(() => {});
    }
    
    return scrollCount;
  }

  // ─── Click into each listing to get details ────────────────────────
  
  async function scrapeAllDetails(leads, onProgress) {
    const results = [];
    const listingLinks = document.querySelectorAll('a.Nv2PK, div[role="article"] a[href*="/maps/place"]');
    
    for (let i = 0; i < Math.min(leads.length, listingLinks.length); i++) {
      if (!isGettingDetails) break; // Allow cancellation
      
      try {
        // Click the listing
        listingLinks[i].click();
        await new Promise(r => setTimeout(r, 1200)); // Wait for detail panel
        
        // Get details
        const details = await getListingDetails();
        results.push({ ...leads[i], ...details });
        
        if (onProgress) {
          onProgress({ current: i + 1, total: leads.length, name: details.name || leads[i].name });
        }
        
        // Close detail panel (press back or close button)
        const closeBtn = document.querySelector('button[aria-label="Back"], button[jsaction*="close"]');
        if (closeBtn) {
          closeBtn.click();
          await new Promise(r => setTimeout(r, 500));
        }
      } catch (e) {
        results.push(leads[i]);
      }
    }
    
    return results;
  }

  // ─── Message Handler ───────────────────────────────────────────────
  
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    
    if (msg.type === 'SCRAPE_MAPS') {
      if (isScraping) {
        sendResponse({ error: 'Already scraping' });
        return true;
      }
      
      isScraping = true;
      
      (async () => {
        try {
          // Step 1: Scrape visible results
          let result = scrapeSearchResults();
          
          if (result.error) {
            sendResponse({ error: result.error });
            isScraping = false;
            return;
          }
          
          // Step 2: Auto-scroll if requested
          if (msg.autoScroll) {
            const scrollCount = await autoScroll(msg.maxScrolls || 20);
            // Re-scrape after scrolling
            result = scrapeSearchResults();
          }
          
          scrapedLeads = result.leads || [];
          sendResponse({ 
            success: true, 
            leads: scrapedLeads, 
            total: scrapedLeads.length 
          });
        } catch (e) {
          sendResponse({ error: e.message });
        } finally {
          isScraping = false;
        }
      })();
      
      return true;
    }
    
    if (msg.type === 'GET_DETAILS') {
      if (isGettingDetails) {
        sendResponse({ error: 'Already getting details' });
        return true;
      }
      
      isGettingDetails = true;
      
      (async () => {
        try {
          const leads = msg.leads || scrapedLeads;
          const results = await scrapeAllDetails(leads, (progress) => {
            chrome.runtime.sendMessage({
              type: 'DETAILS_PROGRESS',
              ...progress
            }).catch(() => {});
          });
          
          scrapedLeads = results;
          sendResponse({ success: true, leads: results });
        } catch (e) {
          sendResponse({ error: e.message });
        } finally {
          isGettingDetails = false;
        }
      })();
      
      return true;
    }
    
    if (msg.type === 'CANCEL_SCRAPE') {
      isGettingDetails = false;
      isScraping = false;
      sendResponse({ ok: true });
      return true;
    }
    
    if (msg.type === 'GET_SCRAPE_STATUS') {
      sendResponse({ 
        isScraping, 
        isGettingDetails, 
        leadsCount: scrapedLeads.length 
      });
      return true;
    }
    
    if (msg.type === 'GET_LEADS') {
      sendResponse({ leads: scrapedLeads });
      return true;
    }
    
    if (msg.type === 'IS_MAPS_PAGE') {
      const isMaps = window.location.href.includes('google.com/maps');
      const hasResults = document.querySelectorAll('a.Nv2PK, div[role="article"]').length > 0;
      sendResponse({ isMaps, hasResults });
      return true;
    }
  });
  
  console.log('[Maps Lead Scraper] Content script v1.0 loaded');
})();
