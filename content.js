// Maps Lead Scraper — Content Script v3.0
// TESTED APPROACH: click → scrape detail → click Back → scroll → repeat

(() => {
  'use strict';

  let shouldCancel = false;

  const wait = ms => new Promise(r => setTimeout(r, ms));

  function clean(text) {
    return (text || '').replace(/[\ue000-\uf8ff]/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // ─── Scrape Basic Data from Search Results Sidebar ────────────────
  
  function scrapeListings() {
    const results = [];
    const seen = new Set();
    
    // Each listing card is an <a> with href containing /maps/place/
    const cards = document.querySelectorAll('a[href*="/maps/place/"]');
    
    for (const card of cards) {
      try {
        const lead = {
          name: '', category: '', rating: 0, reviews: 0,
          address: '', phone: '', website: '', email: '',
          hours: '', priceLevel: '', url: '', lat: 0, lng: 0
        };
        
        // URL
        lead.url = card.href;
        const coordMatch = lead.url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
        if (coordMatch) {
          lead.lat = parseFloat(coordMatch[1]);
          lead.lng = parseFloat(coordMatch[2]);
        }
        
        // Get all text from the card
        const allText = clean(card.textContent);
        const lines = allText.split(/·/).map(l => l.trim()).filter(Boolean);
        
        // Name: first line that's not a number and not too short
        for (const line of lines) {
          if (line.length > 2 && !line.match(/^[\d.]+$/) && !line.match(/^\([\d,.]+\)$/)) {
            lead.name = line;
            break;
          }
        }
        
        // Category: look for known keywords
        const catWords = ['Kedai','Kafe','Restoran','Toko','Klinik','Hotel','Coffee','Restaurant','Store','Shop','Clinic','Cafe','Spa','Salon','Gym','Studio','Agency','Warung','Mall','Bengkel','Apotek','Kantor','Photography','Aesthetic'];
        for (const line of lines) {
          if (catWords.some(w => line.toLowerCase().includes(w.toLowerCase()))) {
            lead.category = line;
            break;
          }
        }
        
        // Rating: "X.X" pattern
        const ratingMatch = allText.match(/(\d\.\d)/);
        if (ratingMatch) {
          const val = parseFloat(ratingMatch[1]);
          if (val >= 1 && val <= 5) lead.rating = val;
        }
        
        // Reviews: "(X.XXX)" or "(XXX)" pattern
        const reviewsMatch = allText.match(/\(([\d,.]+)\)/);
        if (reviewsMatch) {
          lead.reviews = parseInt(reviewsMatch[1].replace(/[.,]/g, ''));
        }
        
        // Deduplicate by name
        if (lead.name && !seen.has(lead.name)) {
          seen.add(lead.name);
          results.push(lead);
        }
        
      } catch (e) {}
    }
    
    return results;
  }

  // ─── Scrape Detail Panel (after clicking a listing) ───────────────
  
  function scrapeDetailPanel() {
    const detail = {};
    
    // === NAME ===
    // h1 is the most reliable for the business name
    const h1 = document.querySelector('h1');
    if (h1) detail.name = clean(h1.textContent);
    
    // === CATEGORY ===
    // Usually a button right below h1, or in a span near h1
    const h1Parent = h1?.parentElement;
    if (h1Parent) {
      const siblings = h1Parent.querySelectorAll('button, span');
      for (const sib of siblings) {
        const text = clean(sib.textContent);
        // Category is usually short, not a number, not a button action
        if (text && text.length > 2 && text.length < 60 && 
            !text.match(/^\d/) && !text.includes('Directions') && 
            !text.includes('Save') && !text.includes('Share') &&
            !text.includes('Call') && text !== detail.name) {
          detail.category = text;
          break;
        }
      }
    }
    
    // === RATING ===
    // Look for the specific rating display pattern
    // Google Maps shows rating as "X.X" in a specific span, often near stars
    const allSpans = document.querySelectorAll('span');
    for (const span of allSpans) {
      const text = clean(span.textContent);
      // Rating is exactly "X.X" format, standalone
      if (text.match(/^\d\.\d$/) && span.children.length === 0) {
        const val = parseFloat(text);
        if (val >= 1 && val <= 5) {
          detail.rating = val;
          break;
        }
      }
    }
    
    // === REVIEWS ===
    // "(X,XXX)" pattern near the rating
    for (const span of allSpans) {
      const text = clean(span.textContent);
      if (text.match(/^\([\d,.]+\)$/) && span.children.length === 0) {
        detail.reviews = parseInt(text.replace(/[().,]/g, ''));
        break;
      }
    }
    
    // === ADDRESS ===
    // data-item-id="address" is the most reliable
    const addressBtn = document.querySelector('[data-item-id="address"] button') ||
                       document.querySelector('button[data-item-id="address"]');
    if (addressBtn) {
      const ariaLabel = addressBtn.getAttribute('aria-label') || '';
      detail.address = clean(ariaLabel.replace(/^Address:\s*/i, '') || addressBtn.textContent);
    }
    
    // === PHONE ===
    // data-item-id contains "phone"
    const phoneBtn = document.querySelector('[data-item-id*="phone"] button') ||
                     document.querySelector('button[data-item-id*="phone"]');
    if (phoneBtn) {
      const ariaLabel = phoneBtn.getAttribute('aria-label') || '';
      const raw = ariaLabel.replace(/^Phone:\s*/i, '') || phoneBtn.textContent;
      const phoneMatch = raw.match(/[\d\s\-+()]{8,}/);
      if (phoneMatch) detail.phone = phoneMatch[0].trim();
    }
    
    // === WEBSITE ===
    // data-item-id="authority"
    const webEl = document.querySelector('[data-item-id="authority"] a') ||
                  document.querySelector('a[data-item-id="authority"]');
    if (webEl) {
      detail.website = webEl.href || clean(webEl.textContent);
    } else {
      // Try button version
      const webBtn = document.querySelector('[data-item-id="authority"] button');
      if (webBtn) {
        detail.website = clean(webBtn.getAttribute('aria-label')?.replace(/^Website:\s*/i, '') || webBtn.textContent);
      }
    }
    
    // === HOURS ===
    // data-item-id contains "hours"
    const hoursBtn = document.querySelector('[data-item-id*="hours"] button') ||
                     document.querySelector('button[data-item-id*="hours"]');
    if (hoursBtn) {
      const ariaLabel = hoursBtn.getAttribute('aria-label') || '';
      detail.hours = clean(ariaLabel || hoursBtn.textContent);
    }
    
    // === PRICE LEVEL ===
    const priceSpans = document.querySelectorAll('span[aria-label*="Price"], span[aria-label*="price"]');
    if (priceSpans.length) {
      detail.priceLevel = clean(priceSpans[0].getAttribute('aria-label') || priceSpans[0].textContent);
    }
    
    return detail;
  }

  // ─── Click a listing, scrape detail, go back ──────────────────────
  
  async function processOneListing(cardLink) {
    // 1. Scroll card into view
    cardLink.scrollIntoView({ behavior: 'instant', block: 'center' });
    await wait(200);
    
    // 2. Click the card to open detail panel
    cardLink.click();
    
    // 3. Wait for detail panel to appear
    // We wait for h1 to change (new business name) or for data-item-id elements
    let attempts = 0;
    while (attempts < 10) {
      await wait(300);
      const h1 = document.querySelector('h1');
      if (h1 && clean(h1.textContent)) break;
      attempts++;
    }
    
    // Extra wait for lazy content
    await wait(500);
    
    // 4. Scroll detail panel to load all content
    const detailScroll = document.querySelector('.m6QErb.DxyBCb') || 
                         document.querySelector('.m6QErb.Pf6ghf');
    if (detailScroll && detailScroll.scrollHeight > detailScroll.clientHeight) {
      for (let scroll = 0; scroll <= detailScroll.scrollHeight; scroll += 300) {
        detailScroll.scrollTop = scroll;
        await wait(100);
      }
      // Scroll back to top
      detailScroll.scrollTop = 0;
      await wait(200);
    }
    
    // 5. Scrape the detail panel
    const details = scrapeDetailPanel();
    
    // 6. Click "Back" to return to search results
    const backBtn = document.querySelector('button[aria-label="Back"]') ||
                    document.querySelector('button[jsaction*="back"]') ||
                    document.querySelector('button[data-item-id="back"]');
    if (backBtn) {
      backBtn.click();
      // Wait for search results to come back
      await wait(800);
    }
    
    return details;
  }

  // ─── Auto-scroll search results ───────────────────────────────────
  
  async function autoScroll(maxScrolls, onProgress) {
    // Find the scrollable container for search results
    // It's NOT role="feed" (that's the detail panel sometimes)
    // Look for the container that has the listing cards
    const feed = document.querySelector('[role="feed"]') ||
                 document.querySelector('.m6QErb[aria-label]');
    if (!feed) return 0;
    
    let count = 0;
    let lastHeight = 0;
    let stuck = 0;
    
    while (count < maxScrolls && !shouldCancel) {
      feed.scrollTop = feed.scrollHeight;
      await wait(1500);
      
      if (feed.scrollHeight === lastHeight) {
        stuck++;
        if (stuck >= 3) break;
      } else {
        stuck = 0;
      }
      
      lastHeight = feed.scrollHeight;
      count++;
      
      if (onProgress) {
        const found = document.querySelectorAll('a[href*="/maps/place/"]').length;
        onProgress({ percent: Math.round((count / maxScrolls) * 100), current: count, max: maxScrolls, found });
      }
    }
    
    return count;
  }

  // ─── Extract email from website ───────────────────────────────────
  
  async function extractEmail(url) {
    if (!url || !url.startsWith('http')) return [];
    
    const emails = new Set();
    const pages = [url];
    
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
      const key = (lead.name || '').toLowerCase().trim();
      if (!map.has(key)) {
        map.set(key, lead);
      } else {
        const existing = map.get(key);
        // Merge: keep non-empty values
        for (const k of Object.keys(lead)) {
          if (lead[k] && !existing[k]) existing[k] = lead[k];
        }
      }
    }
    return [...map.values()];
  }

  // ─── Progress ─────────────────────────────────────────────────────
  
  function sendProgress(stage, percent, text, eta) {
    chrome.runtime.sendMessage({ type: 'PROGRESS', stage, percent, text, eta }).catch(() => {});
  }

  // ─── Message Handler ──────────────────────────────────────────────
  
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    
    if (msg.type === 'CHECK_MAPS') {
      sendResponse({ 
        isMaps: location.href.includes('google.com/maps'),
        hasResults: !!document.querySelector('a[href*="/maps/place/"]')
      });
      return true;
    }
    
    if (msg.type === 'CANCEL') {
      shouldCancel = true;
      sendResponse({ ok: true });
      return true;
    }
    
    // === MAIN SCRAPE FLOW ===
    if (msg.type === 'SCRAPE') {
      shouldCancel = false;
      const opts = msg.options || {};
      const startTime = Date.now();
      
      (async () => {
        try {
          
          // ── Step 1: Auto-scroll ──
          if (opts.scroll) {
            sendProgress('scrolling', 0, 'Scrolling...');
            await autoScroll(30, (p) => {
              sendProgress('scrolling', p.percent, 
                `Scrolling... ${p.found} listings (${p.current}/${p.max})`);
            });
          }
          
          if (shouldCancel) { sendResponse({ cancelled: true }); return; }
          
          // ── Step 2: Scrape basic data ──
          sendProgress('scraping', 100, 'Scraping listings...');
          let leads = scrapeListings();
          
          // Limit by maxListings
          if (opts.maxListings > 0 && leads.length > opts.maxListings) {
            leads = leads.slice(0, opts.maxListings);
          }
          
          if (shouldCancel) { sendResponse({ cancelled: true }); return; }
          
          // ── Step 3: Get details ──
          if (opts.details && leads.length > 0) {
            const total = leads.length;
            const detailStart = Date.now();
            
            for (let i = 0; i < total; i++) {
              if (shouldCancel) break;
              
              // Re-find card links each time (DOM changes after Back)
              const cards = document.querySelectorAll('a[href*="/maps/place/"]');
              
              // Find the card that matches this lead's URL
              let targetCard = null;
              for (const card of cards) {
                if (card.href === leads[i].url) {
                  targetCard = card;
                  break;
                }
              }
              
              // If exact URL match not found, try by index
              if (!targetCard && i < cards.length) {
                targetCard = cards[i];
              }
              
              if (!targetCard) continue;
              
              // Click → scrape detail → go back
              const details = await processOneListing(targetCard);
              
              // Merge details into lead (only non-empty values)
              if (details) {
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
                `${leads[i].name} (${i + 1}/${total})`, eta);
            }
          }
          
          if (shouldCancel) { sendResponse({ cancelled: true }); return; }
          
          // ── Step 4: Extract emails ──
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
          
          // ── Step 5: Deduplicate ──
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
  });

  console.log('[Maps Lead Scraper] Content script v3.0 loaded');
})();
