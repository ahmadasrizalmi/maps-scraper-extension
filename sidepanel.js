// Maps Lead Scraper — Side Panel v2.1
// Simplified: one Scrape button handles everything

let leads = [];
let filteredLeads = [];
let sortField = 'index';
let sortDir = 'asc';

const $ = id => document.getElementById(id);

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
  $('btn-xlsx').disabled = !has;
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
    if (sortField === 'index') { va = leads.indexOf(a); vb = leads.indexOf(b); }
    else if (['rating','reviews'].includes(sortField)) { va = va || 0; vb = vb || 0; }
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
    const i = leads.indexOf(l) + 1;
    return `<tr>
      <td>${i}</td>
      <td class="cell-name" title="${esc(l.name)}">${esc(l.name || '-')}</td>
      <td title="${esc(l.category)}">${esc(l.category || '-')}</td>
      <td class="cell-rating">${l.rating ? `★${l.rating}` : '-'}</td>
      <td class="cell-phone">${l.phone ? `<a href="tel:${l.phone}">${esc(l.phone)}</a>` : '-'}</td>
      <td class="cell-website">${l.website ? `<a href="${esc(l.website)}" target="_blank">✓</a>` : '-'}</td>
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
    dedup: $('opt-dedup').checked
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
    render();
    
    toast(`${leads.length} leads scraped${response.elapsed ? ` in ${response.elapsed}s` : ''}`);
    
    // Auto-save
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
    render();
    toast(`Loaded ${leads.length} leads`);
  } else {
    toast('No saved leads');
  }
}

// ─── Export ─────────────────────────────────────────────────────────

function exportCSV() {
  if (!leads.length) return;
  const h = ['No','Name','Category','Rating','Reviews','Address','Phone','Website','Email','Hours','Price','URL','Lat','Lng'];
  const rows = leads.map((l,i) => [i+1,q(l.name),q(l.category),l.rating||'',l.reviews||'',q(l.address),q(l.phone),q(l.website),q(l.email),q(l.hours),q(l.priceLevel),q(l.url),l.lat||'',l.lng||'']);
  download('\ufeff'+[h.join(',')].concat(rows.map(r=>r.join(','))).join('\n'), `leads_${date()}.csv`, 'text/csv');
  toast('CSV exported');
}

function exportExcel() {
  if (!leads.length) return;
  
  const headers = ['No','Name','Category','Rating','Reviews','Address','Phone','Website','Email','Hours','Price','URL','Lat','Lng'];
  
  // Build sheet XML
  let sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  sheet += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>\n';
  
  // Header row
  sheet += '<row r="1">';
  headers.forEach((h, i) => {
    const col = String.fromCharCode(65 + i); // A, B, C...
    sheet += `<c r="${col}1" t="inlineStr"><is><t>${xe(h)}</t></is></c>`;
  });
  sheet += '</row>\n';
  
  // Data rows
  for (let r = 0; r < leads.length; r++) {
    const l = leads[r];
    const rowNum = r + 2;
    const vals = [r+1, l.name||'', l.category||'', l.rating||0, l.reviews||0, l.address||'', l.phone||'', l.website||'', l.email||'', l.hours||'', l.priceLevel||'', l.url||'', l.lat||0, l.lng||0];
    
    sheet += `<row r="${rowNum}">`;
    vals.forEach((v, i) => {
      const col = String.fromCharCode(65 + i);
      const isNum = typeof v === 'number';
      sheet += `<c r="${col}${rowNum}"${isNum ? '' : ' t="inlineStr"'}>${isNum ? `<v>${v}</v>` : `<is><t>${xe(v)}</t></is>`}</c>`;
    });
    sheet += '</row>\n';
  }
  
  sheet += '</sheetData></worksheet>';
  
  // Build XLSX (ZIP with specific XML files)
  const files = {};
  files['[Content_Types].xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>';
  
  files['_rels/.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  
  files['xl/workbook.xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Leads" sheetId="1" r:id="rId1"/></sheets></workbook>';
  
  files['xl/_rels/workbook.xml.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
  
  files['xl/worksheets/sheet1.xml'] = sheet;
  
  // Create ZIP
  const zip = createZip(files);
  const blob = new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  chrome.downloads.download({ url: URL.createObjectURL(blob), filename: `leads_${date()}.xlsx`, saveAs: true });
  toast('Excel exported');
}

// Minimal ZIP file creator (no compression, stored method)
function createZip(files) {
  const entries = [];
  let offset = 0;
  
  // Local file headers + data
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = new TextEncoder().encode(name);
    const dataBytes = new TextEncoder().encode(content);
    const crc = crc32(dataBytes);
    
    // Local file header
    const header = new ArrayBuffer(30 + nameBytes.length);
    const h = new DataView(header);
    h.setUint32(0, 0x04034b50, true); // signature
    h.setUint16(4, 20, true); // version needed
    h.setUint16(6, 0, true); // flags
    h.setUint16(8, 0, true); // compression (stored)
    h.setUint16(10, 0, true); // mod time
    h.setUint16(12, 0, true); // mod date
    h.setUint32(14, crc, true); // crc32
    h.setUint32(18, dataBytes.length, true); // compressed size
    h.setUint32(22, dataBytes.length, true); // uncompressed size
    h.setUint16(26, nameBytes.length, true); // name length
    h.setUint16(28, 0, true); // extra length
    new Uint8Array(header).set(nameBytes, 30);
    
    entries.push({ nameBytes, dataBytes, crc, offset, header });
    offset += header.byteLength + dataBytes.length;
  }
  
  // Central directory
  const centralDir = [];
  let centralSize = 0;
  const centralOffset = offset;
  
  for (const entry of entries) {
    const cd = new ArrayBuffer(46 + entry.nameBytes.length);
    const c = new DataView(cd);
    c.setUint32(0, 0x02014b50, true); // signature
    c.setUint16(4, 20, true); // version made by
    c.setUint16(6, 20, true); // version needed
    c.setUint16(8, 0, true); // flags
    c.setUint16(10, 0, true); // compression
    c.setUint16(12, 0, true); // mod time
    c.setUint16(14, 0, true); // mod date
    c.setUint32(16, entry.crc, true); // crc32
    c.setUint32(20, entry.dataBytes.length, true); // compressed
    c.setUint32(24, entry.dataBytes.length, true); // uncompressed
    c.setUint16(28, entry.nameBytes.length, true); // name length
    c.setUint16(30, 0, true); // extra
    c.setUint16(32, 0, true); // comment
    c.setUint16(34, 0, true); // disk
    c.setUint16(36, 0, true); // internal attrs
    c.setUint32(38, 0, true); // external attrs
    c.setUint32(42, entry.offset, true); // local header offset
    new Uint8Array(cd).set(entry.nameBytes, 46);
    
    centralDir.push(cd);
    centralSize += cd.byteLength;
  }
  
  // End of central directory
  const eocd = new ArrayBuffer(22);
  const e = new DataView(eocd);
  e.setUint32(0, 0x06054b50, true); // signature
  e.setUint16(4, 0, true); // disk
  e.setUint16(6, 0, true); // disk start
  e.setUint16(8, entries.length, true); // entries on disk
  e.setUint16(10, entries.length, true); // total entries
  e.setUint32(12, centralSize, true); // central dir size
  e.setUint32(16, centralOffset, true); // central dir offset
  e.setUint16(20, 0, true); // comment length
  
  // Combine all parts
  const parts = [];
  for (const entry of entries) {
    parts.push(new Uint8Array(entry.header));
    parts.push(entry.dataBytes);
  }
  for (const cd of centralDir) {
    parts.push(new Uint8Array(cd));
  }
  parts.push(new Uint8Array(eocd));
  
  return new Blob(parts);
}

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function exportSheets() {
  if (!leads.length) return;
  const h = ['No','Name','Category','Rating','Reviews','Address','Phone','Website','Email','Hours','Price','URL','Lat','Lng'];
  const rows = leads.map((l,i) => [i+1,l.name||'',l.category||'',l.rating||'',l.reviews||'',l.address||'',l.phone||'',l.website||'',l.email||'',l.hours||'',l.priceLevel||'',l.url||'',l.lat||'',l.lng||'']);
  navigator.clipboard.writeText([h.join('\t')].concat(rows.map(r=>r.join('\t'))).join('\n'));
  toast('Copied! Paste in Google Sheets');
  chrome.tabs.create({ url: 'https://sheets.new' });
}

function q(s){if(!s)return '';s=String(s);return(s.includes(',')||s.includes('"'))?`"${s.replace(/"/g,'""')}"`:s;}
function xe(s){return(s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function date(){return new Date().toISOString().split('T')[0];}
function download(c,n,m){const b=new Blob([c],{type:m});chrome.downloads.download({url:URL.createObjectURL(b),filename:n,saveAs:true});}

// ─── Events ────────────────────────────────────────────────────────

$('btn-scrape').addEventListener('click', () => {
  if ($('btn-scrape').classList.contains('running')) {
    // Cancel
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
$('btn-xlsx').addEventListener('click', exportExcel);
$('btn-sheets').addEventListener('click', exportSheets);
$('btn-open-maps').addEventListener('click', () => chrome.tabs.create({ url: 'https://www.google.com/maps' }));

$('search-input').addEventListener('input', applyFilters);
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

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'PROGRESS') {
    showProgress(msg.text, msg.percent, msg.eta);
  }
});

// ─── Start ─────────────────────────────────────────────────────────

init();
