// Maps Lead Scraper — Content Script v3.3 (optimized)
// Changes: MutationObserver-based waits (~2-3x faster detail scraping),
// adaptive auto-scroll, parallel + cached email extraction, throttled progress.

(() => {
  'use strict';

  let shouldCancel = false;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const clean = t => (t||'').replace(/[\ue000-\uf8ff]/g,'').replace(/\n+/g,' ').replace(/\s+/g,' ').trim();

  // ─── DOM wait helpers (MutationObserver-first) ─────────────────
  // Resolve the moment the selector appears/disappears instead of
  // polling on fixed intervals. Huge speedup on Google Maps SPA.

  function waitFor(selector, timeout = 4000, predicate = () => true) {
    return new Promise(resolve => {
      const el = document.querySelector(selector);
      if (el && predicate(el)) return resolve(el);
      const timer = setTimeout(done, timeout);
      const obs = new MutationObserver(() => {
        const e = document.querySelector(selector);
        if (e && predicate(e)) done(e);
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      function done(el) { clearTimeout(timer); obs.disconnect(); resolve(el ?? null); }
    });
  }

  function waitForGone(selector, timeout = 2500) {
    return new Promise(resolve => {
      if (!document.querySelector(selector)) return resolve();
      const timer = setTimeout(done, timeout);
      const obs = new MutationObserver(() => {
        if (!document.querySelector(selector)) done();
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      function done() { clearTimeout(timer); obs.disconnect(); resolve(); }
    });
  }

  // Resolve when the feed height is stable (content settled) or after a 2.5s cap
  function waitForHeightStable(feed) {
    return new Promise(resolve => {
      const started = Date.now();
      let last = feed.scrollHeight, stableMs = 0;
      const timer = setInterval(() => {
        if (feed.scrollHeight !== last) { last = feed.scrollHeight; stableMs = 0; }
        else stableMs += 100;
        if (stableMs >= 600 || Date.now() - started > 2500) { clearInterval(timer); resolve(); }
      }, 100);
    });
  }

  // ─── Scrape Listings from Sidebar ─────────────────────────────────
  
  function scrapeListings() {
    const results = [];
    const seen = new Set();
    
    const articles = document.querySelectorAll('[role="article"]');
    
    for (const article of articles) {
      try {
        const link = article.querySelector('a[href*="/maps/place/"]');
        if (!link) continue;
        
        const lead = {
          name:'', category:'', rating:0,
          address:'', phone:'', website:'', email:''
        };
        
        // URL
        lead.url = link.href;
        
        // Name: aria-label of the link
        lead.name = link.getAttribute('aria-label') || 
                     article.querySelector('.qBF1Pd, .fontHeadlineSmall')?.textContent?.trim() || '';
        
        // Full text for parsing
        const fullText = clean(article.textContent);
        
        // Rating: image alt "X.X stars" or .MW4etd
        const ratingImg = article.querySelector('img[alt*="stars"]');
        if (ratingImg) {
          const m = ratingImg.alt.match(/(\d\.\d)/);
          if (m) lead.rating = parseFloat(m[1]);
        }
        if (!lead.rating) {
          const ratingEl = article.querySelector('.MW4etd');
          if (ratingEl) {
            const val = parseFloat(ratingEl.textContent);
            if (val >= 1 && val <= 5) lead.rating = val;
          }
        }
        
        // Category: text after name, before address
        const lines = fullText.split(/·/).map(l=>l.trim());
        for (const line of lines) {
          if (line.length > 2 && line.length < 40 && !line.match(/\d{3,}/) && !line.match(/\b(St|Jl|Jalan|Rw|RT|No\.)\b/i)) {
            lead.category = line;
            break;
          }
        }
        
        // Address: contains street keywords
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
    
    // Rating: .MW4etd in the main detail area
    const mainPanel = document.querySelector('main[aria-label]');
    if (mainPanel) {
      const ratingEl = mainPanel.querySelector('.MW4etd');
      if (ratingEl) {
        const val = parseFloat(ratingEl.textContent);
        if (val >= 1 && val <= 5) d.rating = val;
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
    
    return d;
  }

  // ─── Click listing → scrape detail → go back ──────────────────────
  
  async function processOneListing(cardLink) {
    cardLink.scrollIntoView({ behavior:'instant', block:'center' });
    await wait(150);
    
    cardLink.click();
    
    // Detail panel (.DUwDvf) — MutationObserver resolves as soon as it appears.
    // Previously: fixed 300ms polls up to 4.5s.
    const panel = await waitFor('.DUwDvf', 3500, el => {
      const t = el.textContent.trim();
      return t && t !== 'Results';
    });
    if (!panel || shouldCancel) return {};
    
    // Small settle for lazy content
    await wait(300);
    
    // Scroll detail panel containers to force lazy content
    const scrollContainers = document.querySelectorAll('.m6QErb');
    for (const container of scrollContainers) {
      if (container.scrollHeight > container.clientHeight + 50) {
        const step = 600;
        for (let s = 0; s <= container.scrollHeight; s += step) {
          container.scrollTop = s;
          await wait(40);
        }
        container.scrollTop = 0;
        await wait(120);
      }
    }
    
    const details = scrapeDetailPanel();
    
    // Back — wait for the detail panel to actually disappear instead of
    // a fixed 800ms. Falls back after 2.5s max.
    const backBtn = document.querySelector('button[aria-label="Back"]') || 
                    document.querySelector('button[jsaction*="back"]');
    if (backBtn) {
      backBtn.click();
      await waitForGone('.DUwDvf', 2500);
    }
    
    return details;
  }

  // ─── Auto-scroll (adaptive) ────────────────────────────────────────
  
  async function autoScroll(max, onProgress) {
    const feed = document.querySelector('[role="feed"]') || document.querySelector('.m6QErb[aria-label]');
    if (!feed) return 0;
    
    let count = 0, lastH = 0, stuck = 0;
    while (count < max && !shouldCancel) {
      feed.scrollTop = feed.scrollHeight;
      // Resolve early once the feed stops growing (was a fixed 1500ms)
      await waitForHeightStable(feed);
      if (feed.scrollHeight === lastH) { stuck++; if (stuck >= 3) break; } else stuck = 0;
      lastH = feed.scrollHeight;
      count++;
      if (onProgress) onProgress({ percent: Math.round(count/max*100), current: count, max, found: document.querySelectorAll('[role="article"]').length });
    }
    return count;
  }

  // ─── Extract email from website (cached + lazy + parallel) ────────
  
  const emailCache = new Map(); // origin -> emails[]

  async function extractEmail(url) {
    if (!url?.startsWith('http')) return [];
    let origin;
    try { origin = new URL(url).origin; } catch(e) { return []; }
    if (emailCache.has(origin)) return emailCache.get(origin);
    
    const emails = new Set();
    
    // Strip scripts/styles/comments first to kill false positives
    const parse = html => {
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ');
      const matches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
      for (const e of matches) {
        const l = e.toLowerCase();
        if (l.includes('example.com') || l.includes('sentry.io') || l.includes('w3.org') ||
            l.includes('schema.org') || l.includes('googleapis') || l.includes('gstatic') ||
            l.includes('noreply') || /\.(png|jpe?g|gif|webp|svg|css|js)$/.test(l) || l.length >= 50) continue;
        emails.add(l);
      }
    };
    
    const fetchPage = async p => {
      try {
        const r = await fetch(p, { mode:'cors', credentials:'omit', signal: AbortSignal.timeout(3500) });
        if (!r.ok) return false;
        parse(await r.text());
        return true;
      } catch(e) { return false; }
    };
    
    // Homepage first; only probe contact pages if homepage has no email.
    await fetchPage(url);
    if (emails.size === 0) {
      const contactPages = ['/contact', '/about', '/kontak', '/hubungi'];
      await Promise.all(contactPages.map(p => fetchPage(origin + p)));
    }
    
    const result = [...emails];
    emailCache.set(origin, result);
    return result;
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
      let lastEmit = 0;
      
      // Throttle progress messages to ~4/sec (was 1 per listing)
      const emitProgress = (stage, percent, text, eta) => {
        const now = Date.now();
        if (eta === undefined && now - lastEmit < 250) return;
        lastEmit = now;
        chrome.runtime.sendMessage({ type:'PROGRESS', stage, percent, text, eta }).catch(()=>{});
      };
      
      (async () => {
        try {
          // Step 1: Scroll
          if (opts.scroll) {
            emitProgress('scrolling', 0, 'Scrolling...');
            const maxScrolls = opts.maxListings > 0 ? Math.ceil(opts.maxListings * 0.8) : 30;
            await autoScroll(maxScrolls, p => {
              emitProgress('scrolling', p.percent, `Scrolling... ${p.found} found (${p.current}/${p.max})`);
            });
          }
          if (shouldCancel) { sendResponse({ cancelled:true }); return; }
          
          // Step 2: Scrape
          emitProgress('scraping', 100, 'Scraping...');
          let leads = scrapeListings();
          console.log(`[Maps Scraper] Found ${leads.length} listings from DOM`);
          
          // Limit
          if (opts.maxListings > 0 && leads.length > opts.maxListings) leads = leads.slice(0, opts.maxListings);
          
          if (shouldCancel) { sendResponse({ cancelled:true }); return; }
          
          // Step 3: Details (click each listing → scrape detail → back)
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
              const eta = Math.round((elapsed/(i+1))*(total-i-1));
              const etaStr = eta > 60 ? `${Math.round(eta/60)}m` : `${eta}s`;
              emitProgress('details', Math.round((i+1)/total*100), `${leads[i].name} (${i+1}/${total})`, etaStr+' left');
            }
          }
          if (shouldCancel) { sendResponse({ cancelled:true }); return; }
          
          // Step 4: Emails — 6 concurrent workers instead of strictly serial.
          if (opts.emails) {
            const todo = leads.filter(l => l.website && !l.email);
            let next = 0, done = 0, found = 0;
            const worker = async () => {
              while (!shouldCancel) {
                const i = next++;
                if (i >= todo.length) return;
                const emails = await extractEmail(todo[i].website);
                if (emails.length) { todo[i].email = emails[0]; found++; }
                done++;
                emitProgress('emails', Math.round(done/todo.length*100), `Emails: ${found} found (${done}/${todo.length})`);
              }
            };
            await Promise.all(Array.from({ length: Math.min(6, todo.length) }, worker));
          }
          
          // Step 5: Dedup
          if (opts.dedup) leads = deduplicate(leads);
          
          sendResponse({ success:true, leads, elapsed: ((Date.now()-startTime)/1000).toFixed(1) });
        } catch(e) { sendResponse({ error: e.message }); }
      })();
      return true;
    }
  });

  console.log('[Maps Lead Scraper] Content script v3.3 loaded — optimized waits, parallel emails');
})();
