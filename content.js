// Maps Lead Scraper — Content Script v2.0
// Robust Google Maps scraping with email extraction

(() => {
  'use strict';

  let isRunning = false;
  let shouldCancel = false;
  let leads = [];

  // ─── Selectors (multiple fallbacks for Google Maps DOM changes) ───
  
  const SEL = {
    // Search result list container
    feed: [
      '[role="feed"]',
      '.m6QErb.DxyBCb.kA9KIf',
      '.m6QErb[aria-label]',
      'div[role="main"] > div > div'
    ],
    // Individual listing card link
    cardLink: [
      'a.Nv2PK',
      'div[role="article"] a[href*="/maps/place"]',
      'a[href*="/maps/place"]',
      '.hfpxzc'
    ],
    // Listing name in search results
    cardName: [
      '.qBF1Pd',
      '.fontHeadlineSmall',
      '[class*="qBF1Pd"]',
      'div[class*="fontHeadlineSmall"]'
    ],
    // Rating value
    rating: [
      '.MW4etd',
      '[class*="MW4etd"]',
      'span[aria-hidden="true"]'
    ],
    // Reviews count
    reviews: [
      '.UY7F9',
      '[class*="UY7F9"]',
      'span[class*="UY7F9"]'
    ],
    // Detail panel
    detailPanel: [
      '[role="main"]',
      '.m6QErb.DxyBCb',
      '.bJzME.Hu9e2e',
      'div[role="main"] > div'
    ],
    // Detail: name
    detailName: [
      'h1',
      '.DUwDvf',
      '[class*="DUwDvf"]',
      'h1[class*="DUwDvf"]'
    ],
    // Detail: category button
    detailCategory: [
      'button[jsaction*="category"]',
      '.DkEaL',
      'button[class*="DkEaL"]',
      'span[jstcache*="category"]'
    ],
    // Detail: address
    detailAddress: [
      '[data-item-id="address"] .Io6YTe',
      '[data-item-id="address"] font',
      'button[data-item-id="address"]',
      '[aria-label*="Address"]'
    ],
    // Detail: phone
    detailPhone: [
      '[data-item-id*="phone"] .Io6YTe',
      '[data-item-id*="phone"] font',
      'button[data-item-id*="phone"]',
      '[aria-label*="Phone"]',
      '[data-item-id="phone:tel:"] .Io6YTe'
    ],
    // Detail: website
    detailWebsite: [
      '[data-item-id="authority"] .Io6YTe',
      '[data-item-id="authority"] font',
      'a[data-item-id="authority"]',
      '[aria-label*="Website"]',
      '[data-item-id="authority"]'
    ],
    // Detail: hours
    detailHours: [
      '[data-item-id*="hours"] .Io6YTe',
      '[aria-label*="hours"]',
      '[aria-label*="Hours"]',
      'div[data-item-id*="oh"]'
    ],
    // Detail: price level
    detailPrice: [
      '.mgr77e',
      '[class*="mgr77e"]',
      'span[aria-label*="Price"]'
    ],
    // Close/back button
    closeBtn: [
      'button[aria-label="Back"]',
      'button[jsaction*="back"]',
      'button[aria-label*="back"]',
      'button[data-item-id="back"]'
    ],
    // Scrollable detail area
    detailScroll: [
      '.m6QErb.DxyBCb.kA9KIf',
      '.m6QErb.Pf6ghf',
      '[role="main"] .m6QErb'
    ]
  };

  // ─── Helper: Try multiple selectors ───────────────────────────────
  
  function $(selectors, parent = document) {
    for (const sel of selectors) {
      try {
        const el = parent.querySelector(sel);
        if (el) return el;
      } catch (e) {}
    }
    return null;
  }

  function $$(selectors, parent = document) {
    for (const sel of selectors) {
      try {
        const els = parent.querySelectorAll(sel);
        if (els.length > 0) return [...els];
      } catch (e) {}
    }
    return [];
  }

  function wait(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function cleanText(text) {
    if (!text) return '';
    return text.replace(/[\ue000-\uf8ff]/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // ─── Scrape Search Results ────────────────────────────────────────
  
  function scrapeSearchResults() {
    const found = [];
    const seen = new Set();
    
    // Find all listing links
    const links = $$(SEL.cardLink);
    
    for (const link of links) {
      try {
        const lead = extractCardData(link);
        if (lead && lead.name && !seen.has(lead.name)) {
          seen.add(lead.name);
          found.push(lead);
        }
      } catch (e) {}
    }
    
    return found;
  }

  function extractCardData(link) {
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
    
    // URL
    if (link.href && link.href.includes('/maps/place')) {
      lead.url = link.href;
      const coordMatch = link.href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
      if (coordMatch) {
        lead.lat = parseFloat(coordMatch[1]);
        lead.lng = parseFloat(coordMatch[2]);
      }
    }
    
    // Try getting data from the card itself
    const container = link.closest('[role="article"]') || link;
    
    // Name
    const nameEl = $(SEL.cardName, container) || $(SEL.cardName, link);
    if (nameEl) lead.name = cleanText(nameEl.textContent);
    
    // Full text for parsing
    const fullText = cleanText(container.textContent || link.textContent);
    const lines = fullText.split(/[·\n]/).map(l => l.trim()).filter(Boolean);
    
    // Category (usually second line, contains keywords)
    const catKeywords = [
      'Kedai', 'Kafe', 'Restoran', 'Toko', 'Klinik', 'Hotel', 'Rumah',
      'Coffee', 'Restaurant', 'Store', 'Shop', 'Clinic', 'Office',
      'Cafe', 'Bar', 'Spa', 'Salon', 'Gym', 'Studio', 'Agency',
      'Digital', 'Marketing', 'Photography', 'Catering', 'Bakery',
      'Warung', 'Mall', 'Plaza', 'Center', 'Centre', 'Aesthetic',
      'Bengkel', 'Apotek', 'Farmasi', 'Kantor', 'PT ', 'CV ', 'UD '
    ];
    for (const line of lines.slice(0, 5)) {
      if (catKeywords.some(kw => line.toLowerCase().includes(kw.toLowerCase()))) {
        lead.category = line.split('·')[0].trim();
        break;
      }
    }
    
    // Rating
    const ratingEl = $(SEL.rating, container);
    if (ratingEl) {
      const val = parseFloat(ratingEl.textContent);
      if (val >= 1 && val <= 5) lead.rating = val;
    }
    
    // Reviews
    const reviewsEl = $(SEL.reviews, container);
    if (reviewsEl) {
      const match = reviewsEl.textContent.match(/[\d.]+/);
      if (match) lead.reviews = parseInt(match[0].replace('.', ''));
    }
    
    return lead;
  }

  // ─── Get Detail for One Listing ───────────────────────────────────
  
  async function getListingDetail() {
    const panel = $(SEL.detailPanel);
    if (!panel) return null;
    
    await wait(600); // Wait for panel content to load
    
    const lead = {};
    
    // Name
    const nameEl = $(SEL.detailName, panel);
    if (nameEl) lead.name = cleanText(nameEl.textContent);
    
    // Category
    const catEl = $(SEL.detailCategory, panel);
    if (catEl) lead.category = cleanText(catEl.textContent);
    
    // Rating
    const ratingEl = $(SEL.rating, panel);
    if (ratingEl) {
      const val = parseFloat(ratingEl.textContent);
      if (val >= 1 && val <= 5) lead.rating = val;
    }
    
    // Reviews
    const reviewsEl = $(SEL.reviews, panel);
    if (reviewsEl) {
      const match = reviewsEl.textContent.match(/[\d.]+/);
      if (match) lead.reviews = parseInt(match[0].replace('.', ''));
    }
    
    // Address
    const addrEl = $(SEL.detailAddress, panel);
    if (addrEl) lead.address = cleanText(addrEl.getAttribute('aria-label') || addrEl.textContent);
    
    // Phone
    const phoneEl = $(SEL.detailPhone, panel);
    if (phoneEl) {
      const phoneText = phoneEl.getAttribute('aria-label') || phoneEl.textContent;
      const phoneMatch = phoneText.match(/[\d\s\-+()]{8,}/);
      if (phoneMatch) lead.phone = phoneMatch[0].trim();
    }
    
    // Website
    const webEl = $(SEL.detailWebsite, panel);
    if (webEl) {
      lead.website = cleanText(webEl.textContent || webEl.href || '');
      if (!lead.website.startsWith('http')) {
        // Try to get href from parent
        const parentLink = webEl.closest('a');
        if (parentLink) lead.website = parentLink.href || lead.website;
      }
    }
    
    // Hours
    const hoursEl = $(SEL.detailHours, panel);
    if (hoursEl) lead.hours = cleanText(hoursEl.getAttribute('aria-label') || hoursEl.textContent);
    
    // Price level
    const priceEl = $(SEL.detailPrice, panel);
    if (priceEl) lead.priceLevel = cleanText(priceEl.textContent);
    
    return lead;
  }

  // ─── Click Listing & Get Details ──────────────────────────────────
  
  async function clickAndGetDetail(cardLink) {
    return new Promise(async (resolve) => {
      try {
        // Scroll card into view
        cardLink.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await wait(300);
        
        // Click
        cardLink.click();
        await wait(1200); // Wait for detail panel
        
        // Scroll detail panel to load all content
        const detailScroll = $(SEL.detailScroll);
        if (detailScroll) {
          detailScroll.scrollTop = 0;
          await wait(200);
          detailScroll.scrollTop = detailScroll.scrollHeight / 3;
          await wait(200);
          detailScroll.scrollTop = detailScroll.scrollHeight / 2;
          await wait(200);
        }
        
        // Get details
        const details = await getListingDetail();
        resolve(details);
        
      } catch (e) {
        resolve(null);
      }
    });
  }

  // ─── Extract Email from Website ───────────────────────────────────
  
  async function extractEmailFromWebsite(url) {
    if (!url || !url.startsWith('http')) return [];
    
    try {
      // Try fetching the website
      const response = await fetch(url, { 
        mode: 'cors',
        credentials: 'omit',
        signal: AbortSignal.timeout(5000)
      });
      const html = await response.text();
      
      // Extract emails with regex
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const emails = html.match(emailRegex) || [];
      
      // Filter out common false positives
      const validEmails = emails.filter(email => {
        const lower = email.toLowerCase();
        return !lower.includes('example.com') &&
               !lower.includes('sentry.io') &&
               !lower.includes('w3.org') &&
               !lower.includes('schema.org') &&
               !lower.includes('googleapis.com') &&
               !lower.includes('gstatic.com') &&
               !lower.includes('.png') &&
               !lower.includes('.jpg') &&
               !lower.includes('.gif') &&
               !lower.includes('noreply') &&
               lower.length < 50;
      });
      
      // Also check /contact and /about pages
      const pagesToCheck = ['/contact', '/about', '/hubungi', '/tentang'];
      const domain = new URL(url).origin;
      
      for (const page of pagesToCheck) {
        try {
          const pageResponse = await fetch(domain + page, {
            mode: 'cors',
            credentials: 'omit',
            signal: AbortSignal.timeout(3000)
          });
          if (pageResponse.ok) {
            const pageHtml = await pageResponse.text();
            const pageEmails = pageHtml.match(emailRegex) || [];
            validEmails.push(...pageEmails.filter(e => 
              !e.includes('example.com') && !e.includes('sentry.io')
            ));
          }
        } catch (e) {}
      }
      
      // Deduplicate
      return [...new Set(validEmails)];
      
    } catch (e) {
      return [];
    }
  }

  // ─── Auto-scroll to load more results ─────────────────────────────
  
  async function autoScroll(maxScrolls = 30, onProgress) {
    const feed = $(SEL.feed);
    if (!feed) return 0;
    
    let scrollCount = 0;
    let lastHeight = 0;
    let stuckCount = 0;
    
    while (scrollCount < maxScrolls && !shouldCancel) {
      feed.scrollTop = feed.scrollHeight;
      await wait(1200);
      
      const newHeight = feed.scrollHeight;
      if (newHeight === lastHeight) {
        stuckCount++;
        if (stuckCount >= 3) break; // No more results
      } else {
        stuckCount = 0;
      }
      
      lastHeight = newHeight;
      scrollCount++;
      
      if (onProgress) {
        onProgress({
          stage: 'scrolling',
          current: scrollCount,
          max: maxScrolls,
          percent: Math.round((scrollCount / maxScrolls) * 100)
        });
      }
    }
    
    return scrollCount;
  }

  // ─── Deduplicate leads ────────────────────────────────────────────
  
  function deduplicateLeads(leadsList) {
    const seen = new Map();
    
    for (const lead of leadsList) {
      // Key: normalized name + first 20 chars of address
      const key = (lead.name || '').toLowerCase().trim() + '|' + (lead.address || '').toLowerCase().trim().substring(0, 20);
      
      if (!seen.has(key)) {
        seen.set(key, lead);
      } else {
        // Merge: keep the one with more data
        const existing = seen.get(key);
        seen.set(key, mergeLead(existing, lead));
      }
    }
    
    return [...seen.values()];
  }

  function mergeLead(a, b) {
    return {
      name: a.name || b.name,
      category: a.category || b.category,
      rating: a.rating || b.rating,
      reviews: a.reviews || b.reviews,
      address: a.address || b.address,
      phone: a.phone || b.phone,
      website: a.website || b.website,
      email: a.email || b.email,
      hours: a.hours || b.hours,
      priceLevel: a.priceLevel || b.priceLevel,
      url: a.url || b.url,
      lat: a.lat || b.lat,
      lng: a.lng || b.lng
    };
  }

  // ─── Message Handler ──────────────────────────────────────────────
  
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    
    if (msg.type === 'CHECK_MAPS') {
      const isMaps = window.location.href.includes('google.com/maps');
      const hasResults = $$(SEL.cardLink).length > 0;
      const feed = $(SEL.feed);
      sendResponse({ isMaps, hasResults, hasFeed: !!feed });
      return true;
    }
    
    if (msg.type === 'SCRAPE_LISTINGS') {
      if (isRunning) {
        sendResponse({ error: 'Already running' });
        return true;
      }
      
      isRunning = true;
      shouldCancel = false;
      
      (async () => {
        try {
          const doScroll = msg.options?.scroll !== false;
          const doDedup = msg.options?.dedup !== false;
          
          // Step 1: Scrape visible
          sendProgress('scraping', 0, 'Scraping visible listings...');
          leads = scrapeSearchResults();
          
          // Step 2: Auto-scroll if enabled
          if (doScroll) {
            await autoScroll(30, (p) => {
              sendProgress('scrolling', p.percent, 
                `Scrolling... ${p.current}/${p.max} (${scrapeSearchResults().length} found)`);
            });
            leads = scrapeSearchResults();
          }
          
          // Step 3: Deduplicate
          if (doDedup) {
            leads = deduplicateLeads(leads);
          }
          
          sendResponse({ success: true, leads, total: leads.length });
          
        } catch (e) {
          sendResponse({ error: e.message });
        } finally {
          isRunning = false;
        }
      })();
      
      return true;
    }
    
    if (msg.type === 'GET_DETAILS') {
      if (isRunning) {
        sendResponse({ error: 'Already running' });
        return true;
      }
      
      isRunning = true;
      shouldCancel = false;
      
      (async () => {
        try {
          const cardLinks = $$(SEL.cardLink);
          const total = Math.min(leads.length, cardLinks.length);
          const startTime = Date.now();
          
          for (let i = 0; i < total; i++) {
            if (shouldCancel) break;
            
            // Click listing and get details
            const details = await clickAndGetDetail(cardLinks[i]);
            
            if (details) {
              // Merge with existing lead data
              leads[i] = mergeLead(leads[i], details);
            }
            
            // Progress with ETA
            const elapsed = (Date.now() - startTime) / 1000;
            const perItem = elapsed / (i + 1);
            const remaining = perItem * (total - i - 1);
            const eta = remaining > 60 ? `${Math.round(remaining/60)}m` : `${Math.round(remaining)}s`;
            
            sendProgress('details', Math.round(((i + 1) / total) * 100),
              `Getting details: ${leads[i].name || 'Unknown'} (${i + 1}/${total})`, eta);
          }
          
          // Close any open detail panel
          const closeBtn = $(SEL.closeBtn);
          if (closeBtn) closeBtn.click();
          
          sendResponse({ success: true, leads });
          
        } catch (e) {
          sendResponse({ error: e.message });
        } finally {
          isRunning = false;
        }
      })();
      
      return true;
    }
    
    if (msg.type === 'EXTRACT_EMAILS') {
      if (isRunning) {
        sendResponse({ error: 'Already running' });
        return true;
      }
      
      isRunning = true;
      shouldCancel = false;
      
      (async () => {
        try {
          const leadsWithWebsite = leads.filter(l => l.website && !l.email);
          const total = leadsWithWebsite.length;
          const startTime = Date.now();
          let found = 0;
          
          for (let i = 0; i < total; i++) {
            if (shouldCancel) break;
            
            const lead = leadsWithWebsite[i];
            const emails = await extractEmailFromWebsite(lead.website);
            
            if (emails.length > 0) {
              lead.email = emails[0]; // Use first email found
              found++;
            }
            
            const elapsed = (Date.now() - startTime) / 1000;
            const perItem = elapsed / (i + 1);
            const remaining = perItem * (total - i - 1);
            const eta = remaining > 60 ? `${Math.round(remaining/60)}m` : `${Math.round(remaining)}s`;
            
            sendProgress('emails', Math.round(((i + 1) / total) * 100),
              `Checking emails: ${lead.name} (${found} found, ${i + 1}/${total})`, eta);
          }
          
          sendResponse({ success: true, leads, emailsFound: found });
          
        } catch (e) {
          sendResponse({ error: e.message });
        } finally {
          isRunning = false;
        }
      })();
      
      return true;
    }
    
    if (msg.type === 'CANCEL') {
      shouldCancel = true;
      isRunning = false;
      sendResponse({ ok: true });
      return true;
    }
    
    if (msg.type === 'GET_LEADS') {
      sendResponse({ leads });
      return true;
    }
  });

  function sendProgress(stage, percent, text, eta) {
    chrome.runtime.sendMessage({
      type: 'PROGRESS',
      stage, percent, text, eta
    }).catch(() => {});
  }

  console.log('[Maps Lead Scraper] Content script v2.0 loaded');
})();
