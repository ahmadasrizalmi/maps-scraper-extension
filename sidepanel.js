// Maps Lead Scraper — Side Panel v2.0
// Full logic: scrape, filter, export, save/load, Google Sheets

let leads = [];
let filteredLeads = [];
let sortField = 'index';
let sortDir = 'asc';
let startTime = 0;

// ─── Helpers ───────────────────────────────────────────────────────

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function $(id) { return document.getElementById(id); }

function toast(msg, duration = 2500) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/1024/1024).toFixed(1) + ' MB';
}

// ─── Check Maps Page ───────────────────────────────────────────────

async function checkPage() {
  const tab = await getCurrentTab();
  const isMaps = tab.url?.includes('google.com/maps');
  
  $('not-maps').classList.toggle('visible', !isMaps);
  document.querySelector('.controls').style.display = isMaps ? '' : 'none';
  $('results-container').style.display = isMaps ? '' : 'none';
  document.querySelector('.footer').style.display = isMaps ? '' : 'none';
  
  return isMaps;
}

// ─── UI Updates ────────────────────────────────────────────────────

function updateStats() {
  const total = leads.length;
  const withPhone = leads.filter(l => l.phone).length;
  const withWebsite = leads.filter(l => l.website).length;
  const withEmail = leads.filter(l => l.email).length;
  
  $('stat-total').textContent = total;
  $('stat-phone').textContent = withPhone;
  $('stat-website').textContent = withWebsite;
  $('stat-email').textContent = withEmail;
  $('lead-count-text').textContent = total;
  
  $('stats').classList.toggle('visible', total > 0);
  $('filter-bar').classList.toggle('visible', total > 0);
  
  const hasLeads = total > 0;
  $('btn-details').disabled = !hasLeads;
  $('btn-emails').disabled = !hasLeads;
  $('btn-export-csv').disabled = !hasLeads;
  $('btn-export-xlsx').disabled = !hasLeads;
  $('btn-sheets').disabled = !hasLeads;
  $('btn-save').disabled = !hasLeads;
}

function showProgress(stage, percent, text, eta) {
  $('progress').classList.add('visible');
  $('progress-text').textContent = text || stage;
  $('progress-fill').style.width = `${percent || 0}%`;
  $('progress-eta').textContent = eta || '';
  
  $('btn-cancel').style.display = '';
  $('btn-scrape').disabled = true;
  $('btn-details').disabled = true;
  $('btn-emails').disabled = true;
}

function hideProgress() {
  $('progress').classList.remove('visible');
  $('btn-cancel').style.display = 'none';
  $('btn-scrape').disabled = false;
  updateStats();
}

function applyFilters() {
  const search = $('search-input').value.toLowerCase();
  const minRating = parseFloat($('filter-rating').value) || 0;
  const hasFilter = $('filter-has').value;
  
  filteredLeads = leads.filter(lead => {
    // Search
    if (search) {
      const text = `${lead.name} ${lead.category} ${lead.address} ${lead.phone} ${lead.website} ${lead.email}`.toLowerCase();
      if (!text.includes(search)) return false;
    }
    
    // Rating
    if (minRating && (lead.rating || 0) < minRating) return false;
    
    // Has filter
    if (hasFilter === 'phone' && !lead.phone) return false;
    if (hasFilter === 'website' && !lead.website) return false;
    if (hasFilter === 'email' && !lead.email) return false;
    if (hasFilter === 'no-phone' && lead.phone) return false;
    
    return true;
  });
  
  // Sort
  filteredLeads.sort((a, b) => {
    let va = a[sortField] || '';
    let vb = b[sortField] || '';
    
    if (sortField === 'index') {
      va = leads.indexOf(a);
      vb = leads.indexOf(b);
    } else if (sortField === 'rating' || sortField === 'reviews') {
      va = va || 0;
      vb = vb || 0;
    } else {
      va = String(va).toLowerCase();
      vb = String(vb).toLowerCase();
    }
    
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
  
  renderTable();
}

function renderTable() {
  const tbody = $('results-body');
  const wrapper = $('table-wrapper');
  const empty = $('empty-state');
  
  if (filteredLeads.length === 0 && leads.length === 0) {
    wrapper.style.display = 'none';
    empty.style.display = 'block';
    return;
  }
  
  empty.style.display = 'none';
  wrapper.style.display = '';
  
  tbody.innerHTML = filteredLeads.map((lead, i) => {
    const origIndex = leads.indexOf(lead) + 1;
    return `<tr>
      <td>${origIndex}</td>
      <td class="cell-name" title="${esc(lead.name)}">${esc(lead.name || '-')}</td>
      <td class="cell-category" title="${esc(lead.category)}">${esc(lead.category || '-')}</td>
      <td class="cell-rating">${lead.rating ? `★ ${lead.rating}` : '-'}</td>
      <td class="cell-phone">${lead.phone ? `<a href="tel:${lead.phone}">${esc(lead.phone)}</a>` : '-'}</td>
      <td class="cell-website">${lead.website ? `<a href="${esc(lead.website)}" target="_blank">✓</a>` : '-'}</td>
      <td class="cell-email">${lead.email ? `<a href="mailto:${esc(lead.email)}">${esc(lead.email.split('@')[1] || lead.email)}</a>` : '-'}</td>
    </tr>`;
  }).join('');
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Scrape ────────────────────────────────────────────────────────

async function scrapeListings() {
  const tab = await getCurrentTab();
  const scroll = $('opt-scroll').checked;
  const dedup = $('opt-dedup').checked;
  
  startTime = Date.now();
  showProgress('scraping', 0, 'Starting scrape...');
  
  chrome.tabs.sendMessage(tab.id, {
    type: 'SCRAPE_LISTINGS',
    options: { scroll, dedup }
  }, (response) => {
    hideProgress();
    
    if (chrome.runtime.lastError) {
      toast('Refresh Google Maps page first');
      return;
    }
    
    if (response?.error) {
      toast(response.error);
      return;
    }
    
    leads = response.leads || [];
    filteredLeads = [...leads];
    renderTable();
    updateStats();
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    toast(`${leads.length} leads scraped in ${elapsed}s`);
    
    // Auto-details if checked
    if ($('opt-details').checked && leads.length > 0) {
      setTimeout(() => getDetails(), 500);
    }
  });
}

// ─── Get Details ───────────────────────────────────────────────────

async function getDetails() {
  const tab = await getCurrentTab();
  startTime = Date.now();
  showProgress('details', 0, 'Getting details...');
  
  chrome.tabs.sendMessage(tab.id, { type: 'GET_DETAILS' }, (response) => {
    hideProgress();
    
    if (chrome.runtime.lastError || response?.error) {
      toast(response?.error || 'Error getting details');
      return;
    }
    
    leads = response.leads || leads;
    filteredLeads = [...leads];
    renderTable();
    updateStats();
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    toast(`Details updated in ${elapsed}s`);
    
    // Auto-emails if checked
    if ($('opt-emails').checked) {
      setTimeout(() => extractEmails(), 500);
    }
  });
}

// ─── Extract Emails ────────────────────────────────────────────────

async function extractEmails() {
  const tab = await getCurrentTab();
  startTime = Date.now();
  showProgress('emails', 0, 'Extracting emails...');
  
  chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_EMAILS' }, (response) => {
    hideProgress();
    
    if (chrome.runtime.lastError || response?.error) {
      toast(response?.error || 'Error extracting emails');
      return;
    }
    
    leads = response.leads || leads;
    filteredLeads = [...leads];
    renderTable();
    updateStats();
    
    const found = response.emailsFound || 0;
    toast(`${found} emails found`);
  });
}

// ─── Cancel ────────────────────────────────────────────────────────

async function cancelOperation() {
  const tab = await getCurrentTab();
  chrome.tabs.sendMessage(tab.id, { type: 'CANCEL' });
  hideProgress();
  toast('Cancelled');
}

// ─── Export CSV ─────────────────────────────────────────────────────

function exportCSV() {
  if (leads.length === 0) return;
  
  const headers = ['No','Name','Category','Rating','Reviews','Address','Phone','Website','Email','Hours','Price','URL','Lat','Lng'];
  const rows = leads.map((l, i) => [
    i+1, csvQ(l.name), csvQ(l.category), l.rating||'', l.reviews||'',
    csvQ(l.address), csvQ(l.phone), csvQ(l.website), csvQ(l.email),
    csvQ(l.hours), csvQ(l.priceLevel), csvQ(l.url), l.lat||'', l.lng||''
  ]);
  
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  downloadFile('\ufeff' + csv, `maps_leads_${dateStr()}.csv`, 'text/csv');
  toast('CSV exported');
}

function csvQ(s) {
  if (!s) return '';
  s = String(s);
  return (s.includes(',')||s.includes('"')||s.includes('\n')) ? `"${s.replace(/"/g,'""')}"` : s;
}

// ─── Export Excel ───────────────────────────────────────────────────

function exportExcel() {
  if (leads.length === 0) return;
  
  const headers = ['No','Name','Category','Rating','Reviews','Address','Phone','Website','Email','Hours','Price','URL','Lat','Lng'];
  
  let xml = '<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n';
  xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n';
  xml += '<Styles><Style ss:ID="h"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#34A853" ss:Pattern="Solid"/></Style></Styles>\n';
  xml += '<Worksheet ss:Name="Leads"><Table>\n';
  xml += '<Column ss:Width="40"/><Column ss:Width="180"/><Column ss:Width="120"/><Column ss:Width="50"/><Column ss:Width="60"/><Column ss:Width="180"/><Column ss:Width="120"/><Column ss:Width="160"/><Column ss:Width="140"/><Column ss:Width="80"/><Column ss:Width="50"/><Column ss:Width="180"/><Column ss:Width="70"/><Column ss:Width="70"/>\n';
  
  xml += '<Row>' + headers.map(h => `<Cell ss:StyleID="h"><Data ss:Type="String">${h}</Data></Cell>`).join('') + '</Row>\n';
  
  for (let i = 0; i < leads.length; i++) {
    const l = leads[i];
    xml += '<Row>';
    xml += `<Cell><Data ss:Type="Number">${i+1}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${xmlEsc(l.name)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${xmlEsc(l.category)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="Number">${l.rating||0}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="Number">${l.reviews||0}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${xmlEsc(l.address)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${xmlEsc(l.phone)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${xmlEsc(l.website)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${xmlEsc(l.email)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${xmlEsc(l.hours)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${xmlEsc(l.priceLevel)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="String">${xmlEsc(l.url)}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="Number">${l.lat||0}</Data></Cell>`;
    xml += `<Cell><Data ss:Type="Number">${l.lng||0}</Data></Cell>`;
    xml += '</Row>\n';
  }
  
  xml += '</Table></Worksheet></Workbook>';
  downloadFile(xml, `maps_leads_${dateStr()}.xls`, 'application/vnd.ms-excel');
  toast('Excel exported');
}

function xmlEsc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Export to Google Sheets ────────────────────────────────────────

async function exportToSheets() {
  if (leads.length === 0) return;
  
  // Build TSV (tab-separated) for easy paste into Google Sheets
  const headers = ['No','Name','Category','Rating','Reviews','Address','Phone','Website','Email','Hours','Price','URL','Lat','Lng'];
  const rows = leads.map((l, i) => [
    i+1, l.name||'', l.category||'', l.rating||'', l.reviews||'',
    l.address||'', l.phone||'', l.website||'', l.email||'',
    l.hours||'', l.priceLevel||'', l.url||'', l.lat||'', l.lng||''
  ]);
  
  const tsv = [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');
  
  // Copy to clipboard
  await navigator.clipboard.writeText(tsv);
  toast('Copied to clipboard! Paste in Google Sheets (Ctrl+V)');
  
  // Open Google Sheets in new tab
  chrome.tabs.create({ url: 'https://sheets.new' });
}

// ─── Save/Load ─────────────────────────────────────────────────────

async function saveLeads() {
  const data = {
    leads,
    savedAt: new Date().toISOString(),
    count: leads.length
  };
  
  await chrome.storage.local.set({ mapsLeads: data });
  toast(`Saved ${leads.length} leads`);
}

async function loadLeads() {
  const result = await chrome.storage.local.get('mapsLeads');
  
  if (result.mapsLeads?.leads) {
    leads = result.mapsLeads.leads;
    filteredLeads = [...leads];
    renderTable();
    updateStats();
    toast(`Loaded ${leads.length} leads (saved ${new Date(result.mapsLeads.savedAt).toLocaleDateString()})`);
  } else {
    toast('No saved leads found');
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename, saveAs: true });
}

function dateStr() {
  return new Date().toISOString().split('T')[0];
}

// ─── Event Listeners ───────────────────────────────────────────────

$('btn-scrape').addEventListener('click', scrapeListings);
$('btn-details').addEventListener('click', getDetails);
$('btn-emails').addEventListener('click', extractEmails);
$('btn-cancel').addEventListener('click', cancelOperation);
$('btn-export-csv').addEventListener('click', exportCSV);
$('btn-export-xlsx').addEventListener('click', exportExcel);
$('btn-sheets').addEventListener('click', exportToSheets);
$('btn-save').addEventListener('click', saveLeads);
$('btn-load').addEventListener('click', loadLeads);
$('btn-open-maps').addEventListener('click', () => chrome.tabs.create({ url: 'https://www.google.com/maps' }));

// Search & filter
$('search-input').addEventListener('input', applyFilters);
$('filter-rating').addEventListener('change', applyFilters);
$('filter-has').addEventListener('change', applyFilters);

// Table sort
document.querySelectorAll('.results-table th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const field = th.dataset.sort;
    if (sortField === field) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortField = field;
      sortDir = 'asc';
    }
    applyFilters();
  });
});

// Listen for progress from content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'PROGRESS') {
    showProgress(msg.stage, msg.percent, msg.text, msg.eta);
  }
});

// ─── Init ──────────────────────────────────────────────────────────

checkPage();

// Load saved leads on startup
chrome.storage.local.get('mapsLeads', (result) => {
  if (result.mapsLeads?.leads?.length > 0) {
    leads = result.mapsLeads.leads;
    filteredLeads = [...leads];
    renderTable();
    updateStats();
  }
});
