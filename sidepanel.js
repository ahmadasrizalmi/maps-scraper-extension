// Maps Lead Scraper — Side Panel v3.6
// v3.6: input gambar, settings LLM terstruktur (jasa/produk, link, gaya
// bahasa), monitoring terkirim/gagal, deteksi nomor tidak terdaftar.
// Export: CSV + Google Sheets (clipboard paste)

let leads = [];
let filteredLeads = [];
let sortField = 'index';
let sortDir = 'asc';

const $ = id => document.getElementById(id);
const leadIndex = new WeakMap(); // lead object -> original index (kills O(n) indexOf)

// Pesan default untuk follow-up WhatsApp — bisa diedit sesuai kebutuhan
const WA_TEMPLATE = (name) => `Halo ${name || 'admin'}, saya ingin menanyakan produk/layanan Anda. Terima kasih.`;

function indexLeads() {
  leadIndex.clear();
  leads.forEach((l, i) => leadIndex.set(l, i));
}

// ─── Phone normalization (Indonesia-first) ──────────────────────────

function normalizePhone(p) {
  if (!p) return '';
  let d = String(p).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('0')) d = '62' + d.slice(1);          // 08xx… → 628xx…
  else if (d.length >= 9 && d.length <= 12 && d.startsWith('8')) d = '62' + d; // 8xx… → 628xx…
  if (d.length < 9 || d.length > 15) return '';
  return d;
}

// ─── Init ──────────────────────────────────────────────────────────

async function init() {
  const tab = await getTab();
  const isMaps = tab.url?.includes('google.com/maps');
  
  $('not-maps').classList.toggle('visible', !isMaps);
  document.querySelector('.controls').style.display = isMaps ? '' : 'none';
  $('results-container').style.display = isMaps ? '' : 'none';
  document.querySelector('.footer').style.display = isMaps ? '' : 'none';
  
  // Load saved leads
  const saved = await chrome.storage.local.get('mapsLeads');
  if (saved.mapsLeads?.leads?.length) {
    leads = saved.mapsLeads.leads;
    filteredLeads = [...leads];
    indexLeads();
    render();
  }
  
  await loadWASettings();
}

async function getTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// ─── UI Helpers ────────────────────────────────────────────────────

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

function updateStats() {
  const t = leads.length;
  $('stat-total').textContent = t;
  $('stat-phone').textContent = leads.filter(l => l.phone).length;
  $('stat-website').textContent = leads.filter(l => l.website).length;
  $('stat-email').textContent = leads.filter(l => l.email).length;
  $('lead-count-text').textContent = t;
  
  $('stats').classList.toggle('visible', t > 0);
  $('filter-bar').classList.toggle('visible', t > 0);
  
  const has = t > 0;
  $('btn-save').disabled = !has;
  $('btn-csv').disabled = !has;
  $('btn-sheets').disabled = !has;
  $('btn-wa').disabled = !has;
}

function showProgress(text, percent, eta) {
  $('progress').classList.add('visible');
  $('progress-text').textContent = text;
  $('progress-fill').style.width = `${percent || 0}%`;
  $('progress-eta').textContent = eta || '';
}

function hideProgress() {
  $('progress').classList.remove('visible');
}

function setRunning(running) {
  const btn = $('btn-scrape');
  const text = $('btn-scrape-text');
  
  if (running) {
    btn.classList.add('running');
    btn.disabled = true;
    text.textContent = 'Scraping...';
    btn.querySelector('svg').innerHTML = '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>';
  } else {
    btn.classList.remove('running');
    btn.disabled = false;
    text.textContent = 'Scrape Listings';
    btn.querySelector('svg').innerHTML = '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>';
  }
}

// ─── Render Table ──────────────────────────────────────────────────

function applyFilters() {
  const search = $('search-input').value.toLowerCase();
  const minRating = parseFloat($('filter-rating').value) || 0;
  const hasFilter = $('filter-has').value;
  
  filteredLeads = leads.filter(l => {
    if (search) {
      const text = `${l.name} ${l.category} ${l.address} ${l.phone} ${l.website} ${l.email}`.toLowerCase();
      if (!text.includes(search)) return false;
    }
    if (minRating && (l.rating || 0) < minRating) return false;
    if (hasFilter === 'phone' && !l.phone) return false;
    if (hasFilter === 'website' && !l.website) return false;
    if (hasFilter === 'email' && !l.email) return false;
    return true;
  });
  
  filteredLeads.sort((a, b) => {
    let va = a[sortField] ?? '';
    let vb = b[sortField] ?? '';
    if (sortField === 'index') { va = leadIndex.get(a) ?? 0; vb = leadIndex.get(b) ?? 0; }
    else if (['rating'].includes(sortField)) { va = va || 0; vb = vb || 0; }
    else { va = String(va).toLowerCase(); vb = String(vb).toLowerCase(); }
    return va < vb ? (sortDir === 'asc' ? -1 : 1) : va > vb ? (sortDir === 'asc' ? 1 : -1) : 0;
  });
  
  render();
}

function render() {
  const tbody = $('results-body');
  const wrap = $('table-wrap');
  const empty = $('empty-state');
  
  if (!filteredLeads.length && !leads.length) {
    wrap.style.display = 'none';
    empty.style.display = 'block';
    return;
  }
  
  empty.style.display = 'none';
  wrap.style.display = '';
  
  tbody.innerHTML = filteredLeads.map((l) => {
    const i = (leadIndex.get(l) ?? 0) + 1;
    const wa = normalizePhone(l.phone);
    return `<tr>
      <td>${i}</td>
      <td class="cell-name" title="${esc(l.name)}">${esc(l.name || '-')}</td>
      <td title="${esc(l.category)}">${esc(l.category || '-')}</td>
      <td class="cell-rating">${l.rating ? `★${l.rating}` : '-'}</td>
      <td class="cell-phone">${l.phone ? `<a href="tel:${l.phone}">${esc(l.phone)}</a>` : '-'}</td>
      <td class="cell-wa">${wa ? `<a class="wa-link" href="https://wa.me/${wa}?text=${encodeURIComponent(WA_TEMPLATE(l.name))}" target="_blank" rel="noopener" title="Chat WhatsApp">WA</a>` : '-'}</td>
      <td class="cell-email">${l.email ? `<a href="mailto:${l.email}">${esc(l.email.split('@')[1] || l.email)}</a>` : '-'}</td>
    </tr>`;
  }).join('');
  
  updateStats();
}

function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ─── Email extraction (runs HERE — extension pages are not CORS-bound) ──

const emailCache = new Map(); // origin -> emails[]

async function extractEmailsFromWebsites(leads, onProgress) {
  const todo = leads.filter(l => l.website && !l.email);
  if (!todo.length) return 0;
  
  let next = 0, done = 0, found = 0;
  
  const parseHtml = (html, set) => {
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
      set.add(l);
    }
  };
  
  const fetchPage = async (p, set) => {
    try {
      const r = await fetch(p, { mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(3500) });
      if (!r.ok) return false;
      parseHtml(await r.text(), set);
      return true;
    } catch (e) { return false; }
  };
  
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= todo.length) return;
      const lead = todo[i];
      const emails = new Set();
      try {
        const origin = new URL(lead.website).origin;
        if (emailCache.has(origin)) {
          for (const e of emailCache.get(origin)) emails.add(e);
        } else {
          await fetchPage(lead.website, emails);
          if (emails.size === 0) {
            await Promise.all(['/contact', '/about', '/kontak', '/hubungi'].map(p => fetchPage(origin + p, emails)));
          }
          emailCache.set(origin, [...emails]);
        }
      } catch (e) {}
      if (emails.size) { lead.email = emails.values().next().value; found++; }
      done++;
      if (onProgress) onProgress(done, todo.length, found);
    }
  };
  
  await Promise.all(Array.from({ length: Math.min(6, todo.length) }, worker));
  return found;
}

// ─── WhatsApp follow-up queue (anti-ban: shuffle + random delay) ─────
// Mode auto   : navigasi tab WhatsApp Web, ketik & kirim via whatsapp.js
// Mode manual : buka chat wa.me saja (tanpa kirim otomatis)

let waRunning = false;
let waStop = false;
let waSettings = {
  apiKey: '', sender: '', model: 'deepseek-v4-flash',
  offer: '', link: '', tone: 'ramah',
  chunkMin: 3, chunkMax: 8, dailyCap: 30, mode: 'auto'
};
const msgCache = new Map(); // nama lead -> pesan yang sudah di-generate
let pendingImages = []; // [{name, type, dataUrl}] gambar untuk dikirim

const wait = ms => new Promise(r => setTimeout(r, ms));

async function loadWASettings() {
  const s = await chrome.storage.local.get('waSettings');
  if (s.waSettings) waSettings = { ...waSettings, ...s.waSettings };
  $('wa-api-key').value = waSettings.apiKey;
  $('wa-sender').value = waSettings.sender;
  $('wa-model').value = waSettings.model;
  $('wa-offer').value = waSettings.offer;
  $('wa-link').value = waSettings.link || '';
  $('wa-tone').value = waSettings.tone;
  $('wa-chunk-min').value = waSettings.chunkMin;
  $('wa-chunk-max').value = waSettings.chunkMax;
  $('wa-cap').value = waSettings.dailyCap;
  $('wa-mode').value = waSettings.mode;
}

async function saveWASettings() {
  waSettings = {
    apiKey: $('wa-api-key').value.trim(),
    sender: $('wa-sender').value.trim(),
    model: $('wa-model').value,
    offer: $('wa-offer').value.trim(),
    link: $('wa-link').value.trim(),
    tone: $('wa-tone').value,
    chunkMin: Math.max(1, parseInt($('wa-chunk-min').value, 10) || 3),
    chunkMax: Math.max(2, parseInt($('wa-chunk-max').value, 10) || 8),
    dailyCap: Math.max(1, parseInt($('wa-cap').value, 10) || 30),
    mode: $('wa-mode').value
  };
  await chrome.storage.local.set({ waSettings });
}

// Batas harian (per tanggal, disimpan di chrome.storage)
async function waCountToday() {
  const today = new Date().toISOString().split('T')[0];
  const d = await chrome.storage.local.get('waDaily');
  return (d.waDaily && d.waDaily.date === today) ? d.waDaily.count : 0;
}
async function bumpWACount() {
  const today = new Date().toISOString().split('T')[0];
  const d = await chrome.storage.local.get('waDaily');
  const count = (d.waDaily && d.waDaily.date === today) ? d.waDaily.count : 0;
  await chrome.storage.local.set({ waDaily: { date: today, count: count + 1 } });
}

// Gaya bahasa yang bisa dipilih user
const TONES = {
  ramah: 'Bahasa santai namun sopan, hangat, dan akrab.',
  formal: 'Bahasa formal dan sopan, sapa dengan Bapak/Ibu.',
  profesional: 'Bahasa profesional, jelas, langsung ke poin.',
  persuasif: 'Bahasa persuasif, tonjolkan manfaat jasa/produk, dorong untuk mencoba.',
  singkat: 'Pesan singkat dan padat, langsung ke inti, maksimal 80 kata.'
};

// Pesan personal via DeepSeek (deepseek-v4-flash, non-thinking)
async function generateMessage(lead) {
  if (!waSettings.apiKey) return null;
  try {
    const sender = waSettings.sender || '[NAMA ANDA]';
    const tone = TONES[waSettings.tone] || TONES.ramah;
    const offer = waSettings.offer || 'menawarkan kerja sama / produk Anda';
    const link = waSettings.link ? `\nLink web/portfolio pengirim: ${waSettings.link}` : '';
    const system = 'Kamu adalah asisten pemasaran yang menulis pesan WhatsApp singkat, sopan, natural, dalam Bahasa Indonesia. Tanpa markdown, tanpa emoji berlebihan, tanpa judul, tanpa bullet. Maksimal 200 kata.';
    const user = `Tulis pesan follow-up WhatsApp untuk pemilik bisnis ini.\nNama bisnis: ${lead.name}\nKategori: ${lead.category || '-'}\nAlamat: ${lead.address || '-'}\nPengirim: ${sender}\nJasa/produk yang ditawarkan: ${offer}${link}\nGaya bahasa: ${tone}\nStruktur: sapa pemilik ${lead.name}, perkenalkan diri singkat, sampaikan penawaran beserta manfaatnya, ajak merespons, akhiri dengan terima kasih.`;
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + waSettings.apiKey },
      body: JSON.stringify({
        model: waSettings.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        thinking: { type: 'disabled' },
        temperature: 0.8,
        max_tokens: 500
      })
    });
    if (!r.ok) throw new Error('DeepSeek HTTP ' + r.status);
    const j = await r.json();
    const text = (j.choices?.[0]?.message?.content || '').trim()
      .replace(/[*_#`>]/g, '')
      .replace(/\s+/g, ' ');
    return text || null;
  } catch (e) {
    console.warn('[WA] LLM gagal, pakai template:', e);
    return null;
  }
}

// Pecah teks panjang jadi chunk seukuran manusia (potong di akhir kalimat)
function splitMessage(text, min = 150, max = 300) {
  const t = (text || '').trim();
  if (!t) return [];
  if (t.length <= max) return [t];
  const sentences = t.match(/[^.!?…]+[.!?…]*\s*/g) || [t];
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > max && cur.length >= min) { chunks.push(cur.trim()); cur = s; }
    else cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

// Manajemen tab WhatsApp Web
async function getWATab() {
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (tabs.length) return tabs[0];
  return chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
}

async function sendToWATab(tabId, msg, attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await chrome.tabs.sendMessage(tabId, msg);
    } catch (e) {
      await wait(1000); // content script mungkin belum siap setelah reload
    }
  }
  return { ok: false, error: 'Tab WA tidak merespons (content script belum siap)' };
}

async function followUpWA() {
  if (waRunning) return;
  await saveWASettings();
  
  const items = leads.filter(l => normalizePhone(l.phone));
  if (!items.length) { toast('Tidak ada nomor HP yang valid'); return; }
  
  const minS = Math.max(5, parseInt($('wa-min').value, 10) || 45);
  const maxS = Math.max(minS + 5, parseInt($('wa-max').value, 10) || 120);
  
  let used = await waCountToday();
  if (used >= waSettings.dailyCap) { toast(`Batas harian tercapai (${waSettings.dailyCap}). Reset besok.`); return; }
  
  // Shuffle urutan supaya polanya tidak robotik
  const queue = [...items].sort(() => Math.random() - 0.5);
  queue.length = Math.min(queue.length, waSettings.dailyCap - used);
  
  waRunning = true;
  waStop = false;
  $('btn-wa').disabled = true;
  $('btn-wa-stop').disabled = false;
  let sentCnt = 0, failCnt = 0;
  const report = () => `Terkirim ${sentCnt} · Gagal ${failCnt} · Total ${queue.length}`;
  
  try {
    if (waSettings.mode === 'auto') {
      // ─── Auto: ketik & kirim di WhatsApp Web ───
      const waTab = await getWATab();
      await wait(2500);
      const ping = await sendToWATab(waTab.id, { type: 'WA_PING' }, 30);
      if (!ping?.loggedIn) {
        toast('Buka tab WhatsApp Web & scan QR dulu, lalu ulangi');
        return;
      }
      
      $('wa-report').textContent = '';
      
      for (let i = 0; i < queue.length; i++) {
        if (waStop) break;
        const l = queue[i];
        const num = normalizePhone(l.phone);
        
        // Generate (atau pakai cache) pesan personal
        let msg = msgCache.get(l.name);
        if (!msg) { msg = await generateMessage(l); if (msg) msgCache.set(l.name, msg); }
        const chunks = splitMessage(msg || WA_TEMPLATE(l.name));
        if (!chunks.length) continue;
        
        const withImg = pendingImages.length > 0;
        const url = withImg
          ? `https://web.whatsapp.com/send?phone=${num}`
          : `https://web.whatsapp.com/send?phone=${num}&text=${encodeURIComponent(chunks[0])}`;
        showProgress(`WA: ${l.name} (${i + 1}/${queue.length}) — ${report()}`, Math.round((i + 1) / queue.length * 100));
        
        await chrome.tabs.update(waTab.id, { url, active: false });
        await wait(4500); // reload halaman + boot aplikasi
        
        const res = await sendToWATab(waTab.id, {
          type: 'WA_SEND',
          chunks: chunks.slice(1),
          prefill: chunks[0],
          images: withImg ? pendingImages : []
        });
        if (res?.ok && res.sent > 0) { sentCnt++; await bumpWACount(); }
        else { failCnt++; console.warn('[WA] gagal untuk', l.name, res?.error || 'tidak ada respon'); }
        
        if (i < queue.length - 1 && !waStop) {
          const delay = Math.round((minS + Math.random() * (maxS - minS)) * 1000);
          showProgress(`WA: ${i + 1}/${queue.length} selesai — ${report()}. Berikutnya (${queue[i + 1].name}) dalam ~${Math.round(delay / 1000)}s`, Math.round((i + 1) / queue.length * 100));
          await wait(delay);
        } else {
          showProgress(`WA: selesai ${i + 1}/${queue.length} — ${report()}`, 100);
        }
      }
    } else {
      // ─── Manual: buka chat wa.me saja ───
      for (let i = 0; i < queue.length; i++) {
        if (waStop) break;
        const l = queue[i];
        const url = `https://wa.me/${normalizePhone(l.phone)}?text=${encodeURIComponent(WA_TEMPLATE(l.name))}`;
        chrome.tabs.create({ url, active: i === 0 });
        const pct = Math.round((i + 1) / queue.length * 100);
        if (i < queue.length - 1) {
          const delayMs = Math.round((minS + Math.random() * (maxS - minS)) * 1000);
          showProgress(`WA: ${i + 1}/${queue.length} — chat ${l.name || ''} dibuka. Berikutnya dalam ~${Math.round(delayMs / 1000)}s`, pct);
          await wait(delayMs);
        } else {
          showProgress(`WA: selesai ${i + 1}/${queue.length}`, 100);
        }
      }
    }
  } finally {
    waRunning = false;
    $('btn-wa').disabled = false;
    $('btn-wa-stop').disabled = true;
    hideProgress();
    if (waSettings.mode === 'auto') $('wa-report').textContent = report();
    toast(waStop ? 'Follow up WA dihentikan' : `Selesai: ${queue.length} chat`);
  }
}

function stopFollowUpWA() {
  waStop = true;
  $('btn-wa-stop').disabled = true;
  toast('Menghentikan antrian WA…');
}

// ─── Scrape (unified flow) ─────────────────────────────────────────

async function scrape() {
  const tab = await getTab();
  
  const options = {
    scroll: $('opt-scroll').checked,
    details: $('opt-details').checked,
    emails: $('opt-emails').checked,
    dedup: $('opt-dedup').checked,
    maxListings: parseInt($('max-listings').value) || 0
  };
  
  setRunning(true);
  showProgress('Starting...', 0);
  
  chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE', options }, async (response) => {
    setRunning(false);
    hideProgress();
    
    if (chrome.runtime.lastError) {
      toast('Refresh Google Maps page first');
      return;
    }
    
    if (response?.error) {
      toast(response.error);
      return;
    }
    
    if (response?.cancelled) {
      toast('Cancelled');
      return;
    }
    
    leads = response.leads || [];
    filteredLeads = [...leads];
    indexLeads();
    render();
    
    toast(`${leads.length} leads scraped${response.elapsed ? ` in ${response.elapsed}s` : ''}`);
    saveLeads();
    
    // Email extraction runs here (extension page fetch = CORS-free)
    if (response.emailsRequested && leads.some(l => l.website)) {
      showProgress('Mencari email…', 0);
      const found = await extractEmailsFromWebsites(leads, (d, t, f) => {
        showProgress(`Email: ${f} ditemukan (${d}/${t})`, Math.round(d / t * 100));
      });
      hideProgress();
      render();
      saveLeads();
      toast(`${found} email ditemukan dari ${leads.filter(l => l.website).length} website`);
    }
  });
}

// ─── Save/Load ─────────────────────────────────────────────────────

async function saveLeads() {
  await chrome.storage.local.set({ mapsLeads: { leads, savedAt: new Date().toISOString() } });
}

async function loadLeads() {
  const saved = await chrome.storage.local.get('mapsLeads');
  if (saved.mapsLeads?.leads?.length) {
    leads = saved.mapsLeads.leads;
    filteredLeads = [...leads];
    indexLeads();
    render();
    toast(`Loaded ${leads.length} leads`);
  } else {
    toast('No saved leads');
  }
}

// ─── Export CSV ─────────────────────────────────────────────────────

function exportCSV() {
  if (!leads.length) return;
  const h = ['No','Name','Category','Rating','Address','Phone','WhatsApp','Website','Email','URL'];
  const rows = leads.map((l,i) => [i+1,q(l.name),q(l.category),l.rating||'',q(l.address),q(l.phone),q(normalizePhone(l.phone)),q(l.website),q(l.email),q(l.url)]);
  download('\ufeff'+[h.join(',')].concat(rows.map(r=>r.join(','))).join('\n'), `leads_${date()}.csv`, 'text/csv');
  toast('CSV exported');
}

// ─── Export to Google Sheets (clipboard → sheets.new) ───────────────

function exportSheets() {
  if (!leads.length) return;
  const h = ['No','Name','Category','Rating','Address','Phone','WhatsApp','Website','Email','URL'];
  const rows = leads.map((l,i) => [i+1, l.name||'', l.category||'', l.rating||'', l.address||'', l.phone||'', normalizePhone(l.phone)||'', l.website||'', l.email||'', l.url||'']);
  const tsv = [h.join('\t')].concat(rows.map(r=>r.join('\t'))).join('\n');
  
  navigator.clipboard.writeText(tsv).then(() => {
    toast('Copied! Paste in Google Sheets (Ctrl+V)');
    chrome.tabs.create({ url: 'https://sheets.new' });
  }).catch(() => {
    // Fallback: create textarea for copy
    const ta = document.createElement('textarea');
    ta.value = tsv;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast('Copied! Paste in Google Sheets (Ctrl+V)');
    chrome.tabs.create({ url: 'https://sheets.new' });
  });
}

function q(s){if(!s)return '';s=String(s);return(s.includes(',')||s.includes('"'))?`"${s.replace(/"/g,'""')}"`:s;}
function date(){return new Date().toISOString().split('T')[0];}
function download(c,n,m){
  const url = URL.createObjectURL(new Blob([c],{type:m}));
  chrome.downloads.download({url, filename:n, saveAs:true});
  // Revoke the object URL after the download had time to start (memory leak fix)
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// ─── Events ────────────────────────────────────────────────────────

$('btn-scrape').addEventListener('click', () => {
  if ($('btn-scrape').classList.contains('running')) {
    getTab().then(tab => chrome.tabs.sendMessage(tab.id, { type: 'CANCEL' }));
    setRunning(false);
    hideProgress();
    toast('Cancelled');
  } else {
    scrape();
  }
});

$('btn-save').addEventListener('click', () => { saveLeads(); toast('Saved'); });
$('btn-load').addEventListener('click', loadLeads);
$('btn-csv').addEventListener('click', exportCSV);
$('btn-sheets').addEventListener('click', exportSheets);
$('btn-open-maps').addEventListener('click', () => chrome.tabs.create({ url: 'https://www.google.com/maps' }));

$('btn-wa').addEventListener('click', followUpWA);
$('btn-wa-stop').addEventListener('click', stopFollowUpWA);

// Pilih gambar untuk dikirim bersama pesan
$('wa-image').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  const imgs = [];
  for (const f of files) {
    const dataUrl = await new Promise(res => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(f);
    });
    imgs.push({ name: f.name, type: f.type, dataUrl });
  }
  pendingImages = imgs;
  $('wa-image-label').textContent = imgs.length ? imgs.map(i => i.name).join(', ') : 'belum ada gambar';
  e.target.value = ''; // izinkan pilih file yang sama lagi
});

// Debounced search — rebuild the table at most every 150ms while typing
let searchTimer = null;
$('search-input').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(applyFilters, 150);
});
$('filter-rating').addEventListener('change', applyFilters);
$('filter-has').addEventListener('change', applyFilters);

document.querySelectorAll('.results-table th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const f = th.dataset.sort;
    if (sortField === f) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortField = f; sortDir = 'asc'; }
    applyFilters();
  });
});

// rAF-throttled progress rendering — coalesce bursts of PROGRESS messages
let pendingProgress = null;
let rafScheduled = false;
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'PROGRESS') return;
  pendingProgress = msg;
  if (rafScheduled) return;
  rafScheduled = true;
  requestAnimationFrame(() => {
    rafScheduled = false;
    if (pendingProgress) showProgress(pendingProgress.text, pendingProgress.percent, pendingProgress.eta);
    pendingProgress = null;
  });
});

// ─── Start ─────────────────────────────────────────────────────────

init();
