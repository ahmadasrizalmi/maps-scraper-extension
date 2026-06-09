// Maps Lead Scraper — Content Script v2.1
// Fixed: robust detail scraping, unified flow, no redundancy

(() => {
  'use strict';

  let shouldCancel = false;

  // ─── Helpers ─────────────────────────────────────────────────────
  
  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
  
  function clean(text) {
    return (text || '').replace(/[\ue000-\uf8ff]/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // ─── Find elements with multiple selectors ───────────────────────
  
  function find(selectors, parent = document) {
    for (const sel of selectors) {
      try {
        const el = parent.querySelector(sel);
        if (el) return el;
      } catch (e) {}
    }
    return null;
  }

  function findAll(selectors, parent = document) {
    for (const sel of selectors) {
      try {
        const els = parent.querySelectorAll(sel);
        if (els.length > 0) return [...els];
      } catch (e) {}
    }
    return [];
  }

  // ─── Scrape Search Results (Sidebar) ─────────────────────────────
  
  function scrapeListings() {
    const found = [];
    const seen = new Set();
    
    // Find all place links in the search results
    const links = findAll([
      'a[href*="/maps/place"]',
      'a.Nv2PK',
      'div[role="article"] a'
    ]);
    
    for (const link of links) {
      try {
        const lead = parseCard(link);
        if (lead.name && !seen.has(lead.name)) {
          seen.add(lead.name);
          found.push(lead);
        }
      } catch (e) {}
    }
    
    return found;
  }

  function parseCard(link) {
    const lead = { name:'', category:'', rating:0, reviews:0, address:'', phone:'', website:'', email:'', hours:'', priceLevel:'', url:'', lat:0, lng:0 };
    
    // URL + coordinates
    lead.url = link.href || '';
    const coordMatch = lead.url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (coordMatch) {
      lead.lat = parseFloat(coordMatch[1]);
      lead.lng = parseFloat(coordMatch[2]);
    }
    
    // Container (the article or the link itself)
    const container = link.closest('[role="article"]') || link;
    const text = clean(container.textContent);
    const lines = text.split(/·|\n/).map(l => l.trim()).filter(Boolean);
    
    // Name — first significant text, usually in a specific div
    const nameCandidates = container.querySelectorAll('div, span');
    for (const el of nameCandidates) {
      const t = clean(el.textContent);
      if (t && t.length > 2 && t.length < 100 && !t.includes('·') && !t.match(/^\d/) && el.children.length === 0) {
        lead.name = t;
        break;
      }
    }
    if (!lead.name && lines.length > 0) lead.name = lines[0];
    
    // Category
    const catKeywords = ['Kedai','Kafe','Restoran','Toko','Klinik','Hotel','Rumah','Coffee','Restaurant','Store','Shop','Clinic','Office','Cafe','Bar','Spa','Salon','Gym','Studio','Agency','Digital','Marketing','Photography','Catering','Bakery','Warung','Mall','Plaza','Center','Centre','Aesthetic','Bengkel','Apotek','Farmasi','Kantor'];
    for (const line of lines.slice(1, 5)) {
      if (catKeywords.some(kw => line.toLowerCase().includes(kw.toLowerCase()))) {
        lead.category = line.split('·')[0].trim();
        break;
      }
    }
    
    // Rating — look for "X.X" pattern
    for (const line of lines) {
      const m = line.match(/^(\d\.\d)$/);
      if (m) { lead.rating = parseFloat(m[1]); break; }
    }
    
    // Reviews — look for "(X)" or "(X.XXX)" pattern
    for (const line of lines) {
      const m = line.match(/^\(([\d.]+)\)$/);
      if (m) { lead.reviews = parseInt(m[1].replace(/\./g, '')); break; }
    }
    
    return lead;
  }

  // ─── Get Detail from Detail Panel ────────────────────────────────
  
  function scrapeDetailPanel() {
    // The detail panel shows when a listing is clicked
    // It contains structured data with data-item-id attributes
    
    const lead = { name:'', category:'', rating:0, reviews:0, address:'', phone:'', website:'', email:'', hours:'', priceLevel:'' };
    
    // Name — h1 element in the detail panel
    const h1 = document.querySelector('h1');
    if (h1) lead.name = clean(h1.textContent);
    
    // Category — button below the name
    const categoryBtns = document.querySelectorAll('button');
    for (const btn of categoryBtns) {
      const text = clean(btn.textContent);
      if (text && text.length < 50 && !text.includes('Directions') && !text.includes('Save') && !text.includes('Share')) {
        // Check if it looks like a category (not a button action)
        const parent = btn.parentElement;
        if (parent && parent.querySelector('h1')) {
          lead.category = text;
          break;
        }
      }
    }
    
    // Rating — look for "X.X" in the detail area
    const ratingEls = document.querySelectorAll('span[aria-hidden="true"], div[aria-hidden="true"]');
    for (const el of ratingEls) {
      const text = clean(el.textContent);
      const m = text.match(/^(\d\.\d)$/);
      if (m && parseFloat(m[1]) >= 1 && parseFloat(m[1]) <= 5) {
        lead.rating = parseFloat(m[1]);
        break;
      }
    }
    
    // Reviews — look for "(X)" pattern
    for (const el of ratingEls) {
      const text = clean(el.textContent);
      const m = text.match(/^\(([\d,.]+)\)$/);
      if (m) {
        lead.reviews = parseInt(m[1].replace(/[.,]/g, ''));
        break;
      }
    }
    
    // Address — data-item-id="address" or aria-label with "Address"
    const addrEl = find([
      '[data-item-id="address"] button',
      '[data-item-id="address"]',
      'button[aria-label*="Address"]',
      'button[data-item-id="address"]'
    ]);
    if (addrEl) {
      const ariaLabel = addrEl.getAttribute('aria-label') || '';
      lead.address = clean(ariaLabel.replace(/^Address:\s*/i, '') || addrEl.textContent);
    }
    
    // Phone — data-item-id contains "phone"
    const phoneEl = find([
      '[data-item-id*="phone"] button',
      '[data-item-id*="phone"]',
      'button[aria-label*="Phone"]',
      'button[data-item-id*="phone:"]'
    ]);
    if (phoneEl) {
      const ariaLabel = phoneEl.getAttribute('aria-label') || '';
      const text = ariaLabel.replace(/^Phone:\s*/i, '') || phoneEl.textContent;
      const phoneMatch = text.match(/[\d\s\-+()]{8,}/);
      if (phoneMatch) lead.phone = phoneMatch[0].trim();
    }
    
    // Website — data-item-id="authority"
    const webEl = find([
      '[data-item-id="authority"] a',
      'a[data-item-id="authority"]',
      '[data-item-id="authority"] button',
      'button[aria-label*="Website"]'
    ]);
    if (webEl) {
      lead.website = webEl.href || clean(webEl.getAttribute('aria-label')?.replace(/^Website:\s*/i, '') || webEl.textContent);
      if (lead.website && !lead.website.startsWith('http')) {
        const parentLink = webEl.closest('a');
        if (parentLink?.href) lead.website = parentLink.href;
      }
    }
    
    // Hours — data-item-id contains "hours"
    const hoursEl = find([
      '[data-item-id*="hours"] button',
      '[data-item-id*="hours"]',
      'button[aria-label*="hours"]',
      'button[aria-label*="Open"]'
    ]);
    if (hoursEl) {
      const ariaLabel = hoursEl.getAttribute('aria-label') || '';
      lead.hours = clean(ariaLabel || hoursEl.textContent);
    }
    
    // Price level
    const priceEl = find([
      'span[aria-label*="Price"]',
      'button[aria-label*="Price"]'
    ]);
    if (priceEl) {
      lead.priceLevel = clean(priceEl.getAttribute('aria-label')?.replace(/^Price:\s*/i, '') || priceEl.textContent);
    }
    
    return lead;
  }

  // ─── Click a listing and wait for detail panel ───────────────────
  
  async function clickAndWaitForDetail(cardLink, index, total) {
    try {
      // Scroll card into view
      cardLink.scrollIntoView({ behavior: 'instant', block: 'center' });
      await wait(300);
      
      // Check if already selected (detail panel already open for this listing)
      const isSelected = cardLink.getAttribute('aria-current') === 'true' || 
                         cardLink.classList.contains('tXiQmc');
      
      if (!isSelected) {
        // Click the listing
        cardLink.click();
        // Wait for detail panel to load
        await wait(1500);
      }
      
      // Verify detail panel loaded (h1 should exist with a name)
      const h1 = document.querySelector('h1');
      if (!h1 || !clean(h1.textContent)) {
        // Try clicking again
        cardLink.click();
        await wait(2000);
      }
      
      // Scroll the detail panel to load lazy content
      const scrollContainers = document.querySelectorAll('.m6QErb');
      for (const container of scrollContainers) {
        if (container.scrollHeight > container.clientHeight) {
          container.scrollTop = 0;
          await wait(200);
          container.scrollTop = container.scrollHeight / 4;
          await wait(200);
          container.scrollTop = container.scrollHeight / 2;
          await wait(200);
          container.scrollTop = container.scrollHeight * 3 / 4;
          await wait(200);
          container.scrollTop = container.scrollHeight;
          await wait(300);
        }
      }
      
      // Scrape the detail panel
      const details = scrapeDetailPanel();
      
      return details;
      
    } catch (e) {
      return null;
    }
  }

  // ─── Auto-scroll search results ──────────────────────────────────
  
  async function autoScroll(maxScrolls, onProgress) {
    const feed = document.querySelector('[role="feed"]') || 
                 document.querySelector('.m6QErb.DxyBCb');
    if (!feed) return 0;
    
    let count = 0;
    let lastHeight = 0;
    let stuck = 0;
    
    while (count < maxScrolls && !shouldCancel) {
      feed.scrollTop = feed.scrollHeight;
      await wait(1200);
      
      if (feed.scrollHeight === lastHeight) {
        stuck++;
        if (stuck >= 3) break;
      } else {
        stuck = 0;
      }
      
      lastHeight = feed.scrollHeight;
      count++;
      
      if (onProgress) {
        onProgress({ percent: Math.round((count / maxScrolls) * 100), current: count, max: maxScrolls });
      }
    }
    
    return count;
  }

  // ─── Extract email from website ──────────────────────────────────
  
  async function extractEmail(url) {
    if (!url || !url.startsWith('http')) return [];
    
    const emails = new Set();
    const pages = [url]; // Main page
    
    // Add common contact/about pages
    try {
      const origin = new URL(url).origin;
      pages.push(origin + '/contact', origin + '/about', origin + '/kontak', origin + '/hubungi');
    } catch (e) {}
    
    for (const pageUrl of pages) {
      try {
        const resp = await fetch(pageUrl, { mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(4000) });
        if (!resp.ok) continue;
        const html = await resp.text();
        
        const matches = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
        for (const email of matches) {
          const lower = email.toLowerCase();
          if (!lower.includes('example.com') && !lower.includes('sentry.io') && 
              !lower.includes('w3.org') && !lower.includes('schema.org') &&
              !lower.includes('googleapis') && !lower.includes('gstatic') &&
              !lower.includes('.png') && !lower.includes('.jpg') &&
              !lower.includes('noreply') && lower.length < 50) {
            emails.add(lower);
          }
        }
      } catch (e) {}
    }
    
    return [...emails];
  }

  // ─── Deduplicate ─────────────────────────────────────────────────
  
  function deduplicate(leads) {
    const map = new Map();
    for (const lead of leads) {
      const key = (lead.name || '').toLowerCase() + '|' + (lead.address || '').toLowerCase().substring(0, 20);
      if (!map.has(key)) {
        map.set(key, lead);
      } else {
        // Merge: keep fields from the one that has more data
        const existing = map.get(key);
        map.set(key, {
          name: existing.name || lead.name,
          category: existing.category || lead.category,
          rating: existing.rating || lead.rating,
          reviews: existing.reviews || lead.reviews,
          address: existing.address || lead.address,
          phone: existing.phone || lead.phone,
          website: existing.website || lead.website,
          email: existing.email || lead.email,
          hours: existing.hours || lead.hours,
          priceLevel: existing.priceLevel || lead.priceLevel,
          url: existing.url || lead.url,
          lat: existing.lat || lead.lat,
          lng: existing.lng || lead.lng
        });
      }
    }
    return [...map.values()];
  }

  // ─── Progress Helper ─────────────────────────────────────────────
  
  function sendProgress(stage, percent, text, eta) {
    chrome.runtime.sendMessage({ type: 'PROGRESS', stage, percent, text, eta }).catch(() => {});
  }

  // ─── Main Message Handler ────────────────────────────────────────
  
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    
    // Check if on Google Maps
    if (msg.type === 'CHECK_MAPS') {
      const isMaps = location.href.includes('google.com/maps');
      const hasResults = !!document.querySelector('a[href*="/maps/place"]');
      sendResponse({ isMaps, hasResults });
      return true;
    }
    
    // === UNIFIED SCRAPE FLOW ===
    // One message handles: scroll → scrape → details → emails → dedup
    if (msg.type === 'SCRAPE') {
      shouldCancel = false;
      const opts = msg.options || {};
      const startTime = Date.now();
      
      (async () => {
        try {
          let leads = [];
          
          // Step 1: Auto-scroll
          if (opts.scroll) {
            sendProgress('scrolling', 0, 'Scrolling to load more...');
            await autoScroll(30, (p) => {
              const found = scrapeListings().length;
              sendProgress('scrolling', p.percent, `Scrolling... ${found} listings found`, 
                `${p.current}/${p.max}`);
            });
          }
          
          if (shouldCancel) { sendResponse({ cancelled: true }); return; }
          
          // Step 2: Scrape listings
          sendProgress('scraping', 0, 'Scraping listings...');
          leads = scrapeListings();
          
          if (shouldCancel) { sendResponse({ cancelled: true }); return; }
          
          // Step 3: Get details for each listing
          if (opts.details && leads.length > 0) {
            const total = leads.length;
            const detailStart = Date.now();
            
            // Get fresh card links
            const cardLinks = findAll(['a[href*="/maps/place"]']);
            
            for (let i = 0; i < Math.min(total, cardLinks.length); i++) {
              if (shouldCancel) break;
              
              const details = await clickAndWaitForDetail(cardLinks[i], i, total);
              
              if (details) {
                // Merge details into lead
                leads[i] = { ...leads[i], ...details };
                // Only keep non-empty values from details
                for (const key of Object.keys(details)) {
                  if (details[key]) leads[i][key] = details[key];
                }
              }
              
              // Progress with ETA
              const elapsed = (Date.now() - detailStart) / 1000;
              const perItem = elapsed / (i + 1);
              const remaining = perItem * (total - i - 1);
              const eta = remaining > 60 ? `${Math.round(remaining/60)}m left` : `${Math.round(remaining)}s left`;
              
              sendProgress('details', Math.round(((i + 1) / total) * 100),
                `Details: ${leads[i].name || 'Unknown'} (${i + 1}/${total})`, eta);
            }
            
            // Close detail panel
            const backBtn = find(['button[aria-label="Back"]', 'button[jsaction*="back"]']);
            if (backBtn) backBtn.click();
          }
          
          if (shouldCancel) { sendResponse({ cancelled: true }); return; }
          
          // Step 4: Extract emails
          if (opts.emails) {
            const withWebsite = leads.filter(l => l.website && !l.email);
            const total = withWebsite.length;
            let found = 0;
            
            for (let i = 0; i < total; i++) {
              if (shouldCancel) break;
              
              const emails = await extractEmail(withWebsite[i].website);
              if (emails.length > 0) {
                withWebsite[i].email = emails[0];
                found++;
              }
              
              sendProgress('emails', Math.round(((i + 1) / total) * 100),
                `Emails: ${found} found (${i + 1}/${total})`);
            }
          }
          
          // Step 5: Deduplicate
          if (opts.dedup) {
            leads = deduplicate(leads);
          }
          
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          sendResponse({ success: true, leads, elapsed });
          
        } catch (e) {
          sendResponse({ error: e.message });
        }
      })();
      
      return true;
    }
    
    // Cancel
    if (msg.type === 'CANCEL') {
      shouldCancel = true;
      sendResponse({ ok: true });
      return true;
    }
    
    // Get current leads (for re-operations)
    if (msg.type === 'GET_LEADS') {
      sendResponse({ leads: scrapeListings() });
      return true;
    }
  });

  console.log('[Maps Lead Scraper] Content script v2.1 loaded');
})();
