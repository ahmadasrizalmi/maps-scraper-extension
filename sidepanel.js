// Maps Lead Scraper — Side Panel v3.8.1 (fix: deteksi login WA Web + auto-reload tab)
// Alur: Kumpulkan → Saring → Kirim → Lacak → Follow-up
// Setiap lead punya status: baru | terkirim | dibalas | invalid | skip
// Semua tersimpan otomatis di chrome.storage.

let leads = [];
let filteredLeads = [];
let waSettings = { apiKey:'', sender:'', model:'deepseek-v4-flash', offer:'', link:'', tone:'ramah', chunkMin:3, chunkMax:8, dailyCap:30 };
let pendingImages = []; // [{name, type, dataUrl}]
let sendState = { running:false, stop:false };
let sessions = []; // riwayat sesi pengiriman
const msgCache = new Map(); // (fu:)?nama -> pesan yang sudah di-generate
const wait = ms => new Promise(r => setTimeout(r, ms));
const $ = id => document.getElementById(id);

const STATUS_LABEL = { baru:'Baru', terkirim:'Terkirim', dibalas:'Dibalas', invalid:'Invalid', skip:'Skip' };
const STATUS_CLASS = { baru:'st-new', terkirim:'st-sent', dibalas:'st-replied', invalid:'st-invalid', skip:'st-skip' };

const WA_TEMPLATE = (name) => `Halo ${name || 'admin'}, saya ingin menanyakan produk/layanan Anda. Terima kasih.`;

const TONES = {
  ramah: 'Bahasa santai namun sopan, hangat, dan akrab.',
  formal: 'Bahasa formal dan sopan, sapa dengan Bapak/Ibu.',
  profesional: 'Bahasa profesional, jelas, langsung ke poin.',
  persuasif: 'Bahasa persuasif, tonjolkan manfaat jasa/produk, dorong untuk mencoba.',
  singkat: 'Pesan singkat dan padat, langsung ke inti, maksimal 80 kata.'
};

// ─── Helpers ────────────────────────────────────────────────────────

function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function q(s){ if(!s) return ''; s=String(s); return (s.includes(',')||s.includes('"')) ? `"${s.replace(/"/g,'""')}"` : s; }
function date(){ return new Date().toISOString().split('T')[0]; }
function download(c,n,m){
  const url = URL.createObjectURL(new Blob([c],{type:m}));
  chrome.downloads.download({ url, filename:n, saveAs:true });
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

function showProgress(text, percent, eta) {
  $('progress').classList.add('visible');
  $('progress-text').textContent = text;
  $('progress-fill').style.width = `${percent || 0}%`;
  $('progress-eta').textContent = eta || '';
}
function hideProgress() { $('progress').classList.remove('visible'); }

async function getTab() {
  const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
  return tab;
}

// ─── Persistence ────────────────────────────────────────────────────

async function saveLeads() {
  await chrome.storage.local.set({ mapsLeads: { leads, savedAt: new Date().toISOString() } });
}

async function loadLeads() {
  const s = await chrome.storage.local.get('mapsLeads');
  if (s.mapsLeads?.leads?.length) {
    leads = s.mapsLeads.leads.map(normalizeLead);
    filteredLeads = [...leads];
    renderLeads();
  }
}

function normalizeLead(l) {
  return {
    ...l,
    id: l.id || (l.url || l.name || Math.random().toString(36).slice(2)),
    status: l.status || 'baru',
    sentAt: l.sentAt || null,
    lastError: l.lastError || '',
    history: Array.isArray(l.history) ? l.history : []
  };
}

// ─── Tabs ───────────────────────────────────────────────────────────

function switchTab(name) {
  if (name !== 'pengaturan') saveSettings(); // amankan apapun yang belum tersimpan saat pindah tab
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  ['tab-leads','tab-kirim','tab-pengaturan','tab-riwayat'].forEach(id => $(id).classList.toggle('active', id === 'tab-' + name));
  if (name === 'kirim') updateTargetInfo();
  if (name === 'kirim' || name === 'pengaturan') checkWAStatus(); // auto-cek tanpa reload
}

// ─── Phone normalization (Indonesia-first) ──────────────────────────

function normalizePhone(p) {
  if (!p) return '';
  let d = String(p).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.length >= 9 && d.length <= 12 && d.startsWith('8')) d = '62' + d;
  if (d.length < 9 || d.length > 15) return '';
  return d;
}

// ─── Scrape (Kumpulkan) ─────────────────────────────────────────────

function setScraping(on) {
  $('btn-scrape').disabled = on;
  $('btn-scrape-text').textContent = on ? 'Mengumpulkan…' : 'Scrape dari Google Maps';
}

async function scrape() {
  const tab = await getTab();
  if (!tab.url?.includes('google.com/maps')) {
    toast('Buka Google Maps dulu, lalu klik Scrape');
    return;
  }
  const options = {
    scroll: true, details: true, dedup: true,
    emails: $('opt-emails').checked,
    maxListings: parseInt($('max-listings').value, 10) || 0
  };
  setScraping(true);
  showProgress('Mengumpulkan lead dari Google Maps…', 0);
  
  chrome.tabs.sendMessage(tab.id, { type:'SCRAPE', options }, async (response) => {
    setScraping(false);
    hideProgress();
    if (chrome.runtime.lastError) { toast('Refresh halaman Google Maps dulu'); return; }
    if (response?.error) { toast(response.error); return; }
    if (response?.cancelled) { toast('Dibatalkan'); return; }
    
    leads = (response.leads || []).map(normalizeLead);
    filteredLeads = [...leads];
    renderLeads();
    saveLeads();
    toast(`${leads.length} lead masuk database${response.elapsed ? ` (${response.elapsed}s)` : ''}`);
    
    // Email opsional — dijalankan di sini (extension page bebas CORS)
    if (response.emailsRequested && leads.some(l => l.website)) {
      showProgress('Mencari email…', 0);
      const found = await extractEmailsFromWebsites(leads, (d,t,f) => showProgress(`Email: ${f} ditemukan (${d}/${t})`, Math.round(d/t*100)));
      hideProgress();
      renderLeads();
      saveLeads();
      toast(`${found} email ditemukan`);
    }
  });
}

// ─── Email extraction (CORS-free di extension page) ─────────────────

const emailCache = new Map();

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
      const r = await fetch(p, { mode:'cors', credentials:'omit', signal: AbortSignal.timeout(3500) });
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
        if (emailCache.has(origin)) { for (const e of emailCache.get(origin)) emails.add(e); }
        else {
          await fetchPage(lead.website, emails);
          if (emails.size === 0) await Promise.all(['/contact','/about','/kontak','/hubungi'].map(p => fetchPage(origin + p, emails)));
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

// ─── Leads tab: saring & tampil ─────────────────────────────────────

function applyFilters() {
  const q = $('search-input').value.toLowerCase();
  const st = $('filter-status').value;
  filteredLeads = leads.filter(l => {
    if (q && !`${l.name} ${l.category} ${l.address} ${l.phone} ${l.email}`.toLowerCase().includes(q)) return false;
    if (st && (l.status || 'baru') !== st) return false;
    return true;
  });
  renderLeads();
}

function renderLeads() {
  const tbody = $('results-body');
  const wrap = $('table-wrap');
  const empty = $('empty-state');
  
  if (!leads.length) {
    wrap.style.display = 'none';
    empty.style.display = 'block';
    updateStats();
    return;
  }
  empty.style.display = 'none';
  wrap.style.display = '';
  
  const idx = new Map(leads.map((l, i) => [l, i]));
  tbody.innerHTML = filteredLeads.map(l => {
    const st = l.status || 'baru';
    const wa = normalizePhone(l.phone);
    return `<tr>
      <td>${(idx.get(l) ?? 0) + 1}</td>
      <td class="cell-name" title="${esc(nameTitle(l))}">${esc(l.name || '-')}</td>
      <td title="${esc(l.category)}">${esc(l.category || '-')}</td>
      <td class="cell-rating">${l.rating ? `★${l.rating}` : '-'}</td>
      <td class="cell-phone">${l.phone ? `<a href="tel:${l.phone}">${esc(l.phone)}</a>` : '-'}</td>
      <td class="cell-wa">${wa ? `<a class="wa-link" href="https://wa.me/${wa}?text=${encodeURIComponent(WA_TEMPLATE(l.name))}" target="_blank" rel="noopener" title="Buka chat manual">WA</a>` : '-'}</td>
      <td><select class="status-sel ${STATUS_CLASS[st]}" data-id="${esc(l.id)}" onchange="setStatus(this.dataset.id, this.value)">
        ${Object.keys(STATUS_LABEL).map(k => `<option value="${k}" ${k === st ? 'selected' : ''}>${STATUS_LABEL[k]}</option>`).join('')}
      </select></td>
      <td class="cell-email">${l.email ? `<a href="mailto:${l.email}">${esc(l.email.split('@')[1] || l.email)}</a>` : '-'}</td>
    </tr>`;
  }).join('');
  updateStats();
}

function setStatus(id, status) {
  const l = leads.find(x => x.id === id);
  if (!l) return;
  l.status = status;
  if (status === 'terkirim' && !l.sentAt) l.sentAt = new Date().toISOString();
  logHistory(l, status);
  applyFilters();
  saveLeads();
}

// ─── Riwayat (per lead + per sesi) ────────────────────────────────

function logHistory(lead, e, note) {
  if (!lead.history) lead.history = [];
  lead.history.push({ t: new Date().toISOString(), e, note: note || '' });
  if (lead.history.length > 30) lead.history = lead.history.slice(-30);
}

async function saveSession(session) {
  const s = await chrome.storage.local.get('mapsSessions');
  let arr = s.mapsSessions || [];
  arr.push(session);
  if (arr.length > 50) arr = arr.slice(-50);
  sessions = arr;
  await chrome.storage.local.set({ mapsSessions: arr });
}

async function loadSessions() {
  const s = await chrome.storage.local.get('mapsSessions');
  sessions = s.mapsSessions || [];
}

function renderRiwayat() {
  const el = $('sessions-list');
  if (!el) return;
  if (!sessions.length) {
    el.innerHTML = '<div class="empty-state" style="padding:20px;">Belum ada riwayat pengiriman.</div>';
    return;
  }
  el.innerHTML = sessions.slice().reverse().map(s => {
    const d = new Date(s.t);
    const ds = d.toLocaleString('id-ID', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
    return `<div class="sess-item">
      <div class="row" style="justify-content:space-between;">
        <b>${esc(ds)}</b>
        <span class="hint">${s.mode === 'followup' ? 'Follow-up' : 'Target baru'}</span>
      </div>
      <div class="hint">Terkirim <b style="color:var(--green)">${s.sent}</b> · Gagal <b style="color:var(--red)">${s.failed}</b> · Total ${s.total}</div>
    </div>`;
  }).join('');
}

function nameTitle(l) {
  const h = l.history || [];
  if (!h.length) return l.name || '';
  return (l.name || '') + '\n— Riwayat —\n' +
    h.slice(-6).map(x => `${x.t.slice(0,10)} ${x.t.slice(11,16)} ${x.e}${x.note ? ' (' + x.note + ')' : ''}`).join('\n');
}

function updateStats() {
  const count = st => leads.filter(l => (l.status || 'baru') === st).length;
  $('stat-total').textContent = leads.length;
  $('stat-baru').textContent = count('baru');
  $('stat-terkirim').textContent = count('terkirim');
  $('stat-dibalas').textContent = count('dibalas');
  $('lead-count-text').textContent = leads.length;
  $('btn-csv').disabled = !leads.length;
  $('btn-clear-invalid').disabled = !count('invalid');
}

function exportCSV() {
  if (!leads.length) return;
  const h = ['No','Name','Category','Rating','Address','Phone','WhatsApp','Website','Email','URL','Status','SentAt'];
  const rows = leads.map((l,i) => [
    i+1, q(l.name), q(l.category), l.rating || '', q(l.address), q(l.phone),
    q(normalizePhone(l.phone)), q(l.website), q(l.email), q(l.url),
    q(STATUS_LABEL[l.status] || 'Baru'), q(l.sentAt || '')
  ]);
  download('\ufeff' + [h.join(',')].concat(rows.map(r => r.join(','))).join('\n'), `leads_${date()}.csv`, 'text/csv');
  toast('CSV diekspor');
}

// ─── Kirim tab: target & pesan ──────────────────────────────────────

function targetLeads() {
  const followUp = $('target-followup').checked;
  if (followUp) {
    const days = parseInt($('followup-days').value, 10) || 3;
    const cutoff = Date.now() - days * 86400000;
    return leads.filter(l => (l.status || 'baru') === 'terkirim' && l.sentAt && new Date(l.sentAt).getTime() <= cutoff);
  }
  return leads.filter(l => (l.status || 'baru') === 'baru');
}

function updateTargetInfo() {
  const tg = targetLeads();
  $('followup-row').style.display = $('target-followup').checked ? '' : 'none';
  $('target-count').innerHTML = `<b>${tg.length}</b> target siap kirim`;
  $('target-preview').textContent = tg.length ? 'Contoh: ' + tg.slice(0, 3).map(l => l.name).join(', ') + (tg.length > 3 ? ' …' : '') : 'Tidak ada target — pilih status lain atau ubah filter.';
}

async function saveSettings() {
  try {
    waSettings = {
      apiKey: $('set-api-key').value.trim(),
      model: $('set-model').value,
      chunkMin: Math.max(1, parseInt($('set-chunk-min').value, 10) || 3),
      chunkMax: Math.max(2, parseInt($('set-chunk-max').value, 10) || 8),
      dailyCap: Math.max(1, parseInt($('set-cap').value, 10) || 30),
      sender: $('msg-sender').value.trim(),
      offer: $('msg-offer').value.trim(),
      link: $('msg-link').value.trim(),
      tone: $('msg-tone').value
    };
    await chrome.storage.local.set({ waSettings });
    console.log('[Settings] tersimpan:', Object.keys(waSettings).join(', '));
    return true;
  } catch (e) {
    console.error('[Settings] GAGAL menyimpan:', e);
    return false;
  }
}

function showSettingsSaved() {
  const el = $('settings-status');
  if (el) el.textContent = '✓ Tersimpan ' + new Date().toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

async function loadSettings() {
  const s = await chrome.storage.local.get('waSettings');
  if (s.waSettings) waSettings = { ...waSettings, ...s.waSettings };
  $('set-api-key').value = waSettings.apiKey;
  $('set-model').value = waSettings.model;
  $('set-chunk-min').value = waSettings.chunkMin;
  $('set-chunk-max').value = waSettings.chunkMax;
  $('set-cap').value = waSettings.dailyCap;
  $('msg-sender').value = waSettings.sender;
  $('msg-offer').value = waSettings.offer;
  $('msg-link').value = waSettings.link || '';
  $('msg-tone').value = waSettings.tone;
  if (waSettings.apiKey) showSettingsSaved();
}

// Pesan: manual (dengan {nama}) atau AI per lead
async function getMessage(lead, followUp = false) {
  const manual = $('msg-manual').value.trim();
  if (manual) return manual.replace(/\{nama\}/gi, lead.name || '');
  const key = (followUp ? 'fu:' : '') + (lead.name || lead.url);
  if (msgCache.has(key)) return msgCache.get(key);
  let msg = await generateMessage(lead, followUp);
  if (!msg) msg = WA_TEMPLATE(lead.name);
  msgCache.set(key, msg);
  return msg;
}

async function generateMessage(lead, followUp = false) {
  if (!waSettings.apiKey) return null;
  try {
    const sender = waSettings.sender || '[NAMA ANDA]';
    const tone = TONES[waSettings.tone] || TONES.ramah;
    const offer = waSettings.offer || 'menawarkan kerja sama / produk Anda';
    const link = waSettings.link ? `\nLink web/portfolio pengirim: ${waSettings.link}` : '';
    const system = 'Kamu adalah asisten pemasaran yang menulis pesan WhatsApp singkat, sopan, natural, dalam Bahasa Indonesia. Tanpa markdown, tanpa emoji berlebihan, tanpa judul, tanpa bullet.';
    const user = followUp
      ? `Ini pesan TINDAK LANJUT (follow-up). Sebelumnya kami sudah menghubungi pemilik ${lead.name} namun belum ada balasan. Tulis pesan singkat, sopan, tidak memaksa: ingatkan kembali penawaran berikut. Penawaran: ${offer}${link}. Pengirim: ${sender}. Gaya: ${tone}. Maksimal 120 kata, akhiri dengan terima kasih.`
      : `Tulis pesan WhatsApp untuk pemilik bisnis ini.\nNama bisnis: ${lead.name}\nKategori: ${lead.category || '-'}\nAlamat: ${lead.address || '-'}\nPengirim: ${sender}\nJasa/produk yang ditawarkan: ${offer}${link}\nGaya bahasa: ${tone}\nStruktur: sapa pemilik ${lead.name}, perkenalkan diri singkat, sampaikan penawaran beserta manfaatnya, ajak merespons, akhiri dengan terima kasih. Maksimal 200 kata.`;
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer ' + waSettings.apiKey },
      body: JSON.stringify({
        model: waSettings.model,
        messages: [{ role:'system', content: system }, { role:'user', content: user }],
        thinking: { type:'disabled' },
        temperature: 0.8,
        max_tokens: 500
      })
    });
    if (!r.ok) throw new Error('DeepSeek HTTP ' + r.status);
    const j = await r.json();
    const text = (j.choices?.[0]?.message?.content || '').trim()
      .replace(/[*_#`>]/g, '').replace(/\s+/g, ' ');
    return text || null;
  } catch (e) {
    console.warn('[WA] LLM gagal, pakai template:', e);
    return null;
  }
}

// Split pesan panjang jadi chunk seukuran manusia
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

async function previewMessages() {
  const tg = targetLeads();
  if (!tg.length) { toast('Tidak ada target sesuai pilihan'); return; }
  const samples = await Promise.all(tg.slice(0, 2).map(async l => ({
    name: l.name, text: await getMessage(l, (l.status || 'baru') === 'terkirim')
  })));
  $('preview-box').innerHTML = samples.map(s =>
    `<div class="pv-item"><b>${esc(s.name)}</b><div class="pv-text">${esc(s.text)}</div></div>`
  ).join('');
  toast('Contoh pesan untuk 2 target pertama');
}

// ─── Kirim: WhatsApp Web ────────────────────────────────────────────

async function getWATab() {
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (tabs.length) return tabs[0];
  return chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
}

async function sendToWATab(tabId, msg, attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    try { return await chrome.tabs.sendMessage(tabId, msg); }
    catch (e) { await wait(1000); }
  }
  return { ok: false, error: 'Tab WA tidak merespons' };
}

// Pastikan tab WA siap: content script terpasang & terdeteksi login.
// Kalau tab sudah terbuka sebelum extension di-install/di-reload, content
// script tidak ter-inject otomatis → tab di-reload dulu, lalu dicek ulang.
async function ensureWATabReady() {
  const tab = await getWATab();
  let res = await sendToWATab(tab.id, { type: 'WA_PING' }, 8);
  if (res?.loggedIn) return { tab, loggedIn: true };
  try { await chrome.tabs.reload(tab.id); } catch (e) {}
  await wait(6000);
  res = await sendToWATab(tab.id, { type: 'WA_PING' }, 30);
  return { tab, loggedIn: !!res?.loggedIn };
}

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

async function sendWA() {
  if (sendState.running) return;
  await saveSettings();
  
  const tg = targetLeads();
  if (!tg.length) { toast('Tidak ada target — cek pilihan target & status lead'); return; }
  
  const minS = Math.max(5, parseInt($('wa-min').value, 10) || 45);
  const maxS = Math.max(minS + 5, parseInt($('wa-max').value, 10) || 120);
  
  let used = await waCountToday();
  if (used >= waSettings.dailyCap) { toast(`Batas harian tercapai (${waSettings.dailyCap}). Coba besok.`); return; }
  const queue = tg.slice(0, Math.max(0, waSettings.dailyCap - used)).sort(() => Math.random() - 0.5);
  
  // Cek login WhatsApp Web (reload tab otomatis jika content script belum terpasang)
  const { tab: waTab, loggedIn } = await ensureWATabReady();
  if (!loggedIn) {
    await persistWAStatus(false);
    setWAStatusUI(false);
    toast('Login WhatsApp Web dulu (tab Pengaturan → Login WA Web)');
    return;
  }
  await persistWAStatus(true);
  setWAStatusUI(true);
  
  sendState.running = true;
  sendState.stop = false;
  $('btn-send').disabled = true;
  $('btn-send-stop').disabled = false;
  $('btn-send').classList.add('running');
  $('btn-send-text').textContent = 'Mengirim…';
  $('send-report').textContent = '';
  
  let sent = 0, fail = 0;
  const session = { id: Date.now(), t: new Date().toISOString(), mode: $('target-followup').checked ? 'followup' : 'baru', sent: 0, failed: 0, total: queue.length };
  try {
    for (let i = 0; i < queue.length; i++) {
      if (sendState.stop) break;
      const l = queue[i];
      const num = normalizePhone(l.phone);
      if (!num) {
        l.status = 'invalid'; l.lastError = 'tidak ada nomor';
        logHistory(l, 'invalid', 'tidak ada nomor');
        fail++; session.failed++;
        continue;
      }
      const followUp = (l.status || 'baru') === 'terkirim';
      const msg = await getMessage(l, followUp);
      const chunks = splitMessage(msg);
      if (!chunks.length) continue;
      
      const withImg = pendingImages.length > 0;
      const url = withImg
        ? `https://web.whatsapp.com/send?phone=${num}`
        : `https://web.whatsapp.com/send?phone=${num}&text=${encodeURIComponent(chunks[0])}`;
      
      showProgress(`Kirim ke ${l.name} (${i + 1}/${queue.length}) · Terkirim ${sent} · Gagal ${fail}`, Math.round((i + 1) / queue.length * 100));
      await chrome.tabs.update(waTab.id, { url, active: false });
      await wait(4500); // reload + boot
      
      const res = await sendToWATab(waTab.id, {
        type: 'WA_SEND', chunks: chunks.slice(1), prefill: chunks[0], images: withImg ? pendingImages : []
      });
      
      if (res?.ok && res.sent > 0) {
        sent++; session.sent++;
        l.status = 'terkirim';
        l.sentAt = new Date().toISOString();
        l.lastError = '';
        logHistory(l, followUp ? 'followup' : 'kirim');
        await bumpWACount();
      } else {
        fail++; session.failed++;
        l.status = 'invalid';
        l.lastError = res?.error || 'gagal kirim';
        logHistory(l, 'invalid', l.lastError);
        console.warn('[WA] gagal:', l.name, l.lastError);
      }
      $('send-report').textContent = `Terkirim ${sent} · Gagal ${fail} · Total ${queue.length}`;
      saveLeads(); // crash-safe: status disimpan tiap lead
      
      if (i < queue.length - 1 && !sendState.stop) {
        const d = Math.round((minS + Math.random() * (maxS - minS)) * 1000);
        showProgress(`Jeda ~${Math.round(d / 1000)}s ke ${queue[i + 1].name} · Terkirim ${sent} · Gagal ${fail}`, Math.round((i + 1) / queue.length * 100));
        await wait(d);
      } else {
        showProgress(`Selesai · Terkirim ${sent} · Gagal ${fail}`, 100);
      }
    }
  } finally {
    sendState.running = false;
    $('btn-send').disabled = false;
    $('btn-send-stop').disabled = true;
    $('btn-send').classList.remove('running');
    $('btn-send-text').textContent = 'Kirim';
    hideProgress();
    renderLeads();
    saveLeads();
    await saveSession(session);
    renderRiwayat();
    toast(sendState.stop ? `Dihentikan — ${sent} terkirim` : `Selesai: ${sent} terkirim, ${fail} gagal`);
  }
}

// ─── WhatsApp Web login helper ──────────────────────────────────────

let waStatus = { loggedIn: null, at: null };

async function loadWAStatus() {
  const s = await chrome.storage.local.get('waStatus');
  waStatus = s.waStatus || { loggedIn: null, at: null };
  if (waStatus.loggedIn === true) setWAStatusUI(true, waStatus.at);
  else if (waStatus.loggedIn === false) setWAStatusUI(false);
}

async function persistWAStatus(loggedIn) {
  waStatus = { loggedIn, at: new Date().toISOString() };
  await chrome.storage.local.set({ waStatus });
}

function setWAStatusUI(ok, at) {
  const t = at ? new Date(at).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' }) : new Date().toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' });
  if ($('wa-login-status')) $('wa-login-status').textContent = ok ? `✓ Sudah login (dicek ${t})` : 'Belum login';
  if ($('kirim-wa-status')) $('kirim-wa-status').textContent = ok ? '✓ WhatsApp Web sudah login — siap kirim' : '⚠ WhatsApp Web belum login — klik Login WA Web di tab Pengaturan';
}

// Cek status tanpa reload (aman dipanggil otomatis)
async function checkWAStatus() {
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (!tabs.length) { setWAStatusUI(false); return false; }
  const res = await sendToWATab(tabs[0].id, { type: 'WA_PING' }, 5);
  const ok = !!res?.loggedIn;
  await persistWAStatus(ok);
  setWAStatusUI(ok);
  return ok;
}

async function waLoginCheck() {
  $('wa-login-status').textContent = 'mengecek…';
  const { tab, loggedIn } = await ensureWATabReady(); // dengan reload jika perlu
  await chrome.tabs.update(tab.id, { active: true });
  await persistWAStatus(loggedIn);
  setWAStatusUI(loggedIn);
  toast(loggedIn ? '✓ WhatsApp Web sudah login' : 'Belum login — scan QR di tab WhatsApp Web');
}

// ─── Events ─────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

$('btn-scrape').addEventListener('click', scrape);
$('btn-csv').addEventListener('click', exportCSV);
$('btn-open-maps').addEventListener('click', () => chrome.tabs.create({ url: 'https://www.google.com/maps' }));
$('btn-clear-invalid').addEventListener('click', () => {
  const n = leads.filter(l => l.status === 'invalid').length;
  leads = leads.filter(l => l.status !== 'invalid');
  filteredLeads = [...leads];
  renderLeads();
  saveLeads();
  toast(`${n} lead invalid dihapus`);
});

let searchTimer = null;
$('search-input').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(applyFilters, 150);
});
$('filter-status').addEventListener('change', applyFilters);

$('target-followup').addEventListener('change', updateTargetInfo);
$('target-baru').addEventListener('change', updateTargetInfo);
$('followup-days').addEventListener('change', updateTargetInfo);
$('btn-preview').addEventListener('click', previewMessages);

$('btn-send').addEventListener('click', sendWA);
$('btn-send-stop').addEventListener('click', () => {
  sendState.stop = true;
  $('btn-send-stop').disabled = true;
  toast('Menghentikan pengiriman…');
});

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
  e.target.value = '';
});

$('btn-wa-login').addEventListener('click', waLoginCheck);

// Logout WA Web: reset status persisten + coba logout otomatis di tab WA
$('btn-wa-logout').addEventListener('click', async () => {
  await persistWAStatus(false);
  setWAStatusUI(false);
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (!tabs.length) { toast('Status WA direset (tidak ada tab WA)'); return; }
  await chrome.tabs.update(tabs[0].id, { active: true });
  const res = await sendToWATab(tabs[0].id, { type: 'WA_LOGOUT' }, 10);
  if (res?.ok) toast('Logout WhatsApp Web berhasil');
  else toast('Klik Log out manual di menu ••• tab WA — status sudah direset');
});

// Auto-save settings saat diketik (tidak perlu tombol save)
let settingsTimer = null;
const SETTINGS_FIELDS = ['set-api-key','set-model','set-chunk-min','set-chunk-max','set-cap','msg-sender','msg-offer','msg-link','msg-tone'];
function scheduleSettingsSave() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(async () => {
    await saveSettings();
    showSettingsSaved();
  }, 300);
}
SETTINGS_FIELDS.forEach(id => {
  const el = $(id);
  if (el) {
    el.addEventListener('input', scheduleSettingsSave);
    el.addEventListener('change', scheduleSettingsSave);  // blur/change
    el.addEventListener('keyup', scheduleSettingsSave);   // fallback (autofill dsb)
  }
});

// Tombol Simpan eksplisit
$('btn-save-settings').addEventListener('click', async () => {
  const ok = await saveSettings();
  showSettingsSaved();
  toast(ok ? 'Pengaturan tersimpan' : 'Gagal menyimpan — lihat console');
});

// Lihat / sembunyikan API key (password field kadang diganggu autofill)
$('btn-toggle-key').addEventListener('click', () => {
  const inp = $('set-api-key');
  inp.type = inp.type === 'password' ? 'text' : 'password';
  $('btn-toggle-key').textContent = inp.type === 'password' ? '👁' : '🙈';
});

// Simpan terakhir kali saat panel ditutup
window.addEventListener('beforeunload', () => { saveSettings().catch(() => {}); });

$('btn-clear-sessions').addEventListener('click', async () => {
  sessions = [];
  await chrome.storage.local.remove('mapsSessions');
  renderRiwayat();
  toast('Riwayat dikosongkan');
});

// rAF-throttled progress
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

// ─── Init ───────────────────────────────────────────────────────────

(async function init() {
  await loadSettings();
  await loadLeads();
  await loadSessions();
  await loadWAStatus();
  switchTab('leads');
  updateTargetInfo();
  renderRiwayat();
})();
