// Maps Lead Scraper — Content Script v3.1
// TESTED on live Google Maps — selectors verified

(() => {
  'use strict';

  let shouldCancel = false;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const clean = t => (t||'').replace(/[\ue000-\uf8ff]/g,'').replace(/\n+/g,' ').replace(/\s+/g,' ').trim();

  // ─── Scrape Listings from Sidebar ─────────────────────────────────
  
  function scrapeListings() {
    const results = [];
    const seen = new Set();
    
    // Get all listing cards (role="article" contains the full data)
    const articles = document.querySelectorAll('[role="article"]');
    
    for (const article of articles) {
      try {
        const link = article.querySelector('a[href*="/maps/place/"]');
        if (!link) continue;
        
        const lead = {
          name:'', category:'', rating:0, reviews:0,
          address:'', phone:'', website:'', email:'',
          hours:'', priceLevel:'', url:'', lat:0, lng:0
        };
        
        // URL
        lead.url = link.href;
        const coord = lead.url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
        if (coord) { lead.lat = parseFloat(coord[1]); lead.lng = parseFloat(coord[2]); }
        
        // Name: aria-label of the link, or .qBF1Pd
        lead.name = link.getAttribute('aria-label') || 
                     article.querySelector('.qBF1Pd, .fontHeadlineSmall')?.textContent?.trim() || '';
        
        // Full text for parsing
        const fullText = clean(article.textContent);
        
        // Rating: "X.X" pattern in .W4Efsd or .MW4etd
        const ratingEl = article.querySelector('.MW4etd, .W4Efsd');
        if (ratingEl) {
          const val = parseFloat(ratingEl.textContent);
          if (val >= 1 && val <= 5) lead.rating = val;
        }
        
        // Reviews: "(X)" pattern
        const reviewsEl = article.querySelector('.UY7F9');
        if (reviewsEl) {
          const m = reviewsEl.textContent.match(/[\d,.]+/);
          if (m) lead.reviews = parseInt(m[0].replace(/[.,]/g,''));
        }
        
        // Category: look for known keywords in the text
        const catWords = ['Coffee','Kafe','Restoran','Toko','Klinik','Hotel','Cafe','Spa','Salon','Gym','Studio','Warung','Mall','Bengkel','Apotek','Restaurant','Store','Shop','Clinic','Bar','Agency'];
        const lines = fullText.split(/·/).map(l=>l.trim());
        for (const line of lines) {
          if (catWords.some(w => line.toLowerCase().includes(w.toLowerCase()))) {
            lead.category = line.split(/·/)[0].trim();
            break;
          }
        }
        
        // Address: from full text (after category, usually contains "St" or "Jl" or "Rw")
        for (const line of lines) {
          if (line.match(/\b(St|Jl|Jalan|Rw|RT|No\.|City|Jakarta|Bandung|Surabaya)\b/i) && line.length > 10) {
            lead.address = clean(line);
            break;
          }
        }
        
        if (lead.name && !seen.has(lead.name)) {
          seen.add(lead.name);
          results.push(lead);
        }
      } catch(e) {}
    }
    
    return results;
  }

  // ─── Scrape Detail Panel ──────────────────────────────────────────
  
  function scrapeDetailPanel() {
    const d = {};
    
    // Name: .DUwDvf is the business name in detail panel
    d.name = document.querySelector('.DUwDvf')?.textContent?.trim() || '';
    
    // Category: .DkEaL button
    d.category = document.querySelector('.DkEaL')?.textContent?.trim() || '';
    
    // Rating: .MW4etd in the detail panel (not from search results)
    // We need to find the rating that's inside the main detail area
    const mainPanel = document.querySelector('[role="main"]');
    if (mainPanel) {
      const ratingEl = mainPanel.querySelector('.MW4etd');
      if (ratingEl) {
        const val = parseFloat(ratingEl.textContent);
        if (val >= 1 && val <= 5) d.rating = val;
      }
      
      // Reviews: .UY7F9
      const reviewsEl = mainPanel.querySelector('.UY7F9');
      if (reviewsEl) {
        const m = reviewsEl.textContent.match(/[\d,.]+/);
        if (m) d.reviews = parseInt(m[0].replace(/[.,]/g,''));
      }
    }
    
    // Address: data-item-id="address"
    const addrEl = document.querySelector('[data-item-id="address"] button') || 
                   document.querySelector('[data-item-id="address"]');
    if (addrEl) {
      d.address = clean(addrEl.getAttribute('aria-label')?.replace(/^Address:\s*/i,'') || addrEl.textContent);
    }
    
    // Phone: data-item-id contains "phone"
    const phoneEl = document.querySelector('[data-item-id*="phone"] button') || 
                    document.querySelector('[data-item-id*="phone"]');
    if (phoneEl) {
      const raw = phoneEl.getAttribute('aria-label')?.replace(/^Phone:\s*/i,'') || phoneEl.textContent;
      const m = raw.match(/[\d\s\-+()]{8,}/);
      if (m) d.phone = m[0].trim();
    }
    
    // Website: data-item-id="authority"
    const webEl = document.querySelector('[data-item-id="authority"] a') || 
                  document.querySelector('[data-item-id="authority"] button') ||
                  document.querySelector('[data-item-id="authority"]');
    if (webEl) {
      d.website = webEl.href || clean(webEl.textContent);
      if (d.website && !d.website.startsWith('http')) {
        d.website = 'https://' + d.website;
      }
    }
    
    // Hours: data-item-id contains "hours"
    const hoursEl = document.querySelector('[data-item-id*="hours"] button') || 
                    document.querySelector('[data-item-id*="hours"]');
    if (hoursEl) {
      d.hours = clean(hoursEl.getAttribute('aria-label') || hoursEl.textContent);
    }
    
    return d;
  }

  // ─── Click listing → scrape detail → go back ──────────────────────
  
  async function processOneListing(cardLink) {
    // Scroll into view
    cardLink.scrollIntoView({ behavior:'instant', block:'center' });
    await wait(200);
    
    // Click
    cardLink.click();
    
    // Wait for detail panel (.DUwDvf to appear with business name)
    let name = '';
    for (let i = 0; i < 15; i++) {
      await wait(300);
      name = document.querySelector('.DUwDvf')?.textContent?.trim();
      if (name && name !== 'Results') break;
    }
    
    // Extra wait for lazy content
    await wait(500);
    
    // Scroll detail panel to load all content
    const scrollContainers = document.querySelectorAll('.m6QErb');
    for (const container of scrollContainers) {
      if (container.scrollHeight > container.clientHeight + 50) {
        const step = 300;
        for (let s = 0; s <= container.scrollHeight; s += step) {
          container.scrollTop = s;
          await wait(80);
        }
        container.scrollTop = 0;
        await wait(200);
      }
    }
    
    // Scrape
    const details = scrapeDetailPanel();
    
    // Click Back
    const backBtn = document.querySelector('button[aria-label="Back"]') || 
                    document.querySelector('button[jsaction*="back"]');
    if (backBtn) {
      backBtn.click();
      await wait(800);
    }
    
    return details;
  }

  // ─── Auto-scroll ──────────────────────────────────────────────────
  
  async function autoScroll(max, onProgress) {
    const feed = document.querySelector('[role="feed"]') || document.querySelector('.m6QErb[aria-label]');
    if (!feed) return 0;
    
    let count = 0, lastH = 0, stuck = 0;
    while (count < max && !shouldCancel) {
      feed.scrollTop = feed.scrollHeight;
      await wait(1500);
      if (feed.scrollHeight === lastH) { stuck++; if (stuck >= 3) break; } else stuck = 0;
      lastH = feed.scrollHeight;
      count++;
      if (onProgress) onProgress({ percent: Math.round(count/max*100), current: count, max, found: document.querySelectorAll('[role="article"]').length });
    }
    return count;
  }

  // ─── Extract email ────────────────────────────────────────────────
  
  async function extractEmail(url) {
    if (!url?.startsWith('http')) return [];
    const emails = new Set();
    const pages = [url];
    try { const o = new URL(url).origin; pages.push(o+'/contact',o+'/about',o+'/kontak',o+'/hubungi'); } catch(e){}
    
    for (const p of pages) {
      try {
        const r = await fetch(p, { mode:'cors', credentials:'omit', signal: AbortSignal.timeout(4000) });
        if (!r.ok) continue;
        const html = await r.text();
        const matches = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
        for (const e of matches) {
          const l = e.toLowerCase();
          if (!l.includes('example.com') && !l.includes('sentry.io') && !l.includes('w3.org') && 
              !l.includes('schema.org') && !l.includes('googleapis') && !l.includes('gstatic') &&
              !l.includes('.png') && !l.includes('noreply') && l.length < 50) emails.add(l);
        }
      } catch(e){}
    }
    return [...emails];
  }

  // ─── Deduplicate ──────────────────────────────────────────────────
  
  function deduplicate(leads) {
    const map = new Map();
    for (const l of leads) {
      const key = (l.name||'').toLowerCase().trim();
      if (!map.has(key)) map.set(key, l);
      else { const ex = map.get(key); for (const k of Object.keys(l)) if (l[k] && !ex[k]) ex[k] = l[k]; }
    }
    return [...map.values()];
  }

  // ─── Message Handler ──────────────────────────────────────────────
  
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    
    if (msg.type === 'CHECK_MAPS') {
      sendResponse({ isMaps: location.href.includes('google.com/maps'), hasResults: !!document.querySelector('[role="article"]') });
      return true;
    }
    
    if (msg.type === 'CANCEL') { shouldCancel = true; sendResponse({ ok:true }); return true; }
    
    if (msg.type === 'SCRAPE') {
      shouldCancel = false;
      const opts = msg.options || {};
      const startTime = Date.now();
      
      (async () => {
        try {
          // Step 1: Scroll
          if (opts.scroll) {
            chrome.runtime.sendMessage({ type:'PROGRESS', stage:'scrolling', percent:0, text:'Scrolling...' }).catch(()=>{});
            await autoScroll(30, p => {
              chrome.runtime.sendMessage({ type:'PROGRESS', stage:'scrolling', percent:p.percent, text:`Scrolling... ${p.found} found (${p.current}/${p.max})` }).catch(()=>{});
            });
          }
          if (shouldCancel) { sendResponse({ cancelled:true }); return; }
          
          // Step 2: Scrape
          chrome.runtime.sendMessage({ type:'PROGRESS', stage:'scraping', percent:100, text:'Scraping...' }).catch(()=>{});
          let leads = scrapeListings();
          
          // Limit
          if (opts.maxListings > 0 && leads.length > opts.maxListings) leads = leads.slice(0, opts.maxListings);
          
          if (shouldCancel) { sendResponse({ cancelled:true }); return; }
          
          // Step 3: Details
          if (opts.details && leads.length > 0) {
            const total = leads.length;
            const t0 = Date.now();
            
            for (let i = 0; i < total; i++) {
              if (shouldCancel) break;
              
              // Re-find cards each iteration (DOM changes after Back)
              const articles = document.querySelectorAll('[role="article"]');
              let target = null;
              for (const art of articles) {
                const a = art.querySelector('a[href*="/maps/place/"]');
                if (a && a.href === leads[i].url) { target = a; break; }
              }
              if (!target) continue;
              
              const details = await processOneListing(target);
              if (details) {
                for (const k of Object.keys(details)) if (details[k]) leads[i][k] = details[k];
              }
              
              const elapsed = (Date.now()-t0)/1000;
              const eta = (elapsed/(i+1))*(total-i-1);
              const etaStr = eta > 60 ? `${Math.round(eta/60)}m` : `${Math.round(eta)}s`;
              chrome.runtime.sendMessage({ type:'PROGRESS', stage:'details', percent:Math.round((i+1)/total*100), text:`${leads[i].name} (${i+1}/${total})`, eta: etaStr+' left' }).catch(()=>{});
            }
          }
          if (shouldCancel) { sendResponse({ cancelled:true }); return; }
          
          // Step 4: Emails
          if (opts.emails) {
            const todo = leads.filter(l => l.website && !l.email);
            let found = 0;
            for (let i = 0; i < todo.length; i++) {
              if (shouldCancel) break;
              const emails = await extractEmail(todo[i].website);
              if (emails.length) { todo[i].email = emails[0]; found++; }
              chrome.runtime.sendMessage({ type:'PROGRESS', stage:'emails', percent:Math.round((i+1)/todo.length*100), text:`Emails: ${found} found (${i+1}/${todo.length})` }).catch(()=>{});
            }
          }
          
          // Step 5: Dedup
          if (opts.dedup) leads = deduplicate(leads);
          
          sendResponse({ success:true, leads, elapsed: ((Date.now()-startTime)/1000).toFixed(1) });
        } catch(e) { sendResponse({ error: e.message }); }
      })();
      return true;
    }
  });

  console.log('[Maps Lead Scraper] Content script v3.1 loaded — TESTED');
})();
