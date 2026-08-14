// Maps Lead Scraper — Side Panel v3.3 (optimized)
// Changes: O(1) index lookups (WeakMap), debounced search, rAF-throttled
// progress, revoked object URLs, simplified: Name/Category/Rating/Address/Phone/Website/Email
// Export: CSV + Google Sheets (clipboard paste)

let leads = [];
let filteredLeads = [];
let sortField = 'index';
let sortDir = 'asc';

const $ = id => document.getElementById(id);
const leadIndex = new WeakMap(); // lead object -> original index (kills O(n) indexOf)

function indexLeads() {
  leadIndex.clear();
  leads.forEach((l, i) => leadIndex.set(l, i));
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
    return `<tr>
      <td>${i}</td>
      <td class="cell-name" title="${esc(l.name)}">${esc(l.name || '-')}</td>
      <td title="${esc(l.category)}">${esc(l.category || '-')}</td>
      <td class="cell-rating">${l.rating ? `★${l.rating}` : '-'}</td>
      <td class="cell-phone">${l.phone ? `<a href="tel:${l.phone}">${esc(l.phone)}</a>` : '-'}</td>
      <td class="cell-email">${l.email ? `<a href="mailto:${l.email}">${esc(l.email.split('@')[1] || l.email)}</a>` : '-'}</td>
    </tr>`;
  }).join('');
  
  updateStats();
}

function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

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
  
  chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE', options }, (response) => {
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
  const h = ['No','Name','Category','Rating','Address','Phone','Website','Email','URL'];
  const rows = leads.map((l,i) => [i+1,q(l.name),q(l.category),l.rating||'',q(l.address),q(l.phone),q(l.website),q(l.email),q(l.url)]);
  download('\ufeff'+[h.join(',')].concat(rows.map(r=>r.join(','))).join('\n'), `leads_${date()}.csv`, 'text/csv');
  toast('CSV exported');
}

// ─── Export to Google Sheets (clipboard → sheets.new) ───────────────

function exportSheets() {
  if (!leads.length) return;
  const h = ['No','Name','Category','Rating','Address','Phone','Website','Email','URL'];
  const rows = leads.map((l,i) => [i+1, l.name||'', l.category||'', l.rating||'', l.address||'', l.phone||'', l.website||'', l.email||'', l.url||'']);
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
