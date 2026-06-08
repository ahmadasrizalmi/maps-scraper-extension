// Maps Lead Scraper — Popup Script v1.0

let leads = [];

// ─── Helpers ───────────────────────────────────────────────────────

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function updateStatus(text) {
  document.getElementById('header-status').textContent = text;
}

function updateStats() {
  const total = leads.length;
  const withPhone = leads.filter(l => l.phone).length;
  const withWebsite = leads.filter(l => l.website).length;
  const avgRating = total > 0 
    ? (leads.reduce((sum, l) => sum + (l.rating || 0), 0) / total).toFixed(1) 
    : 0;
  
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-phone').textContent = withPhone;
  document.getElementById('stat-website').textContent = withWebsite;
  document.getElementById('stat-avg-rating').textContent = avgRating;
  document.getElementById('lead-count').textContent = `${total} leads`;
  
  document.getElementById('stats').style.display = total > 0 ? 'flex' : 'none';
  document.getElementById('btn-details').disabled = total === 0;
  document.getElementById('btn-export-csv').disabled = total === 0;
  document.getElementById('btn-export-xlsx').disabled = total === 0;
  document.getElementById('btn-clear').disabled = total === 0;
}

function renderResults() {
  const tbody = document.getElementById('results-body');
  const table = document.getElementById('results-table');
  const empty = document.getElementById('empty-state');
  
  if (leads.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'block';
    return;
  }
  
  empty.style.display = 'none';
  table.style.display = 'table';
  
  tbody.innerHTML = leads.map((lead, i) => `
    <tr>
      <td>${i + 1}</td>
      <td title="${escapeHtml(lead.name)}">${escapeHtml(lead.name || '-')}</td>
      <td title="${escapeHtml(lead.category)}">${escapeHtml(lead.category || '-')}</td>
      <td class="rating">${lead.rating ? `⭐ ${lead.rating}` : '-'}</td>
      <td class="phone">${lead.phone || '-'}</td>
      <td class="website" title="${escapeHtml(lead.website)}">${lead.website ? '✓' : '-'}</td>
    </tr>
  `).join('');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Check if on Google Maps ───────────────────────────────────────

async function checkMapsPage() {
  const tab = await getCurrentTab();
  const isMaps = tab.url && tab.url.includes('google.com/maps');
  
  if (!isMaps) {
    document.getElementById('not-maps').style.display = 'block';
    document.querySelector('.controls').style.display = 'none';
    document.querySelector('.results-container').style.display = 'none';
    document.querySelector('.footer').style.display = 'none';
    return false;
  }
  
  document.getElementById('not-maps').style.display = 'none';
  document.querySelector('.controls').style.display = 'block';
  document.querySelector('.results-container').style.display = 'block';
  document.querySelector('.footer').style.display = 'flex';
  return true;
}

// ─── Scrape Listings ───────────────────────────────────────────────

async function scrapeListings() {
  const tab = await getCurrentTab();
  const autoScroll = document.getElementById('auto-scroll').checked;
  
  updateStatus('🔍 Scraping...');
  document.getElementById('btn-scrape').disabled = true;
  
  const progressEl = document.getElementById('progress');
  progressEl.classList.add('active');
  document.getElementById('progress-text').textContent = 'Scraping listings...';
  document.getElementById('progress-fill').style.width = '0%';
  
  chrome.tabs.sendMessage(tab.id, {
    type: 'SCRAPE_MAPS',
    autoScroll: autoScroll,
    maxScrolls: 30
  }, (response) => {
    progressEl.classList.remove('active');
    document.getElementById('btn-scrape').disabled = false;
    
    if (chrome.runtime.lastError) {
      updateStatus('❌ Refresh Google Maps page first');
      return;
    }
    
    if (response?.error) {
      updateStatus(`❌ ${response.error}`);
      return;
    }
    
    leads = response.leads || [];
    renderResults();
    updateStats();
    updateStatus(`✅ ${leads.length} leads scraped`);
  });
}

// ─── Get Details (click each listing) ──────────────────────────────

async function getDetails() {
  const tab = await getCurrentTab();
  
  updateStatus('📋 Getting details...');
  document.getElementById('btn-details').disabled = true;
  
  const progressEl = document.getElementById('progress');
  progressEl.classList.add('active');
  document.getElementById('progress-text').textContent = 'Getting details...';
  
  chrome.tabs.sendMessage(tab.id, {
    type: 'GET_DETAILS',
    leads: leads
  }, (response) => {
    progressEl.classList.remove('active');
    document.getElementById('btn-details').disabled = false;
    
    if (chrome.runtime.lastError) {
      updateStatus('❌ Error getting details');
      return;
    }
    
    if (response?.error) {
      updateStatus(`❌ ${response.error}`);
      return;
    }
    
    leads = response.leads || [];
    renderResults();
    updateStats();
    updateStatus(`✅ Details updated for ${leads.length} leads`);
  });
}

// ─── Export to CSV ─────────────────────────────────────────────────

function exportCSV() {
  if (leads.length === 0) return;
  
  const headers = ['No', 'Name', 'Category', 'Rating', 'Reviews', 'Address', 'Phone', 'Website', 'Email', 'Hours', 'Price Level', 'URL', 'Latitude', 'Longitude'];
  
  const rows = leads.map((lead, i) => [
    i + 1,
    csvEscape(lead.name),
    csvEscape(lead.category),
    lead.rating || '',
    lead.reviews || '',
    csvEscape(lead.address),
    csvEscape(lead.phone),
    csvEscape(lead.website),
    csvEscape(lead.email),
    csvEscape(lead.hours),
    csvEscape(lead.priceLevel),
    csvEscape(lead.url),
    lead.lat || '',
    lead.lng || ''
  ]);
  
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const filename = `maps_leads_${new Date().toISOString().split('T')[0]}.csv`;
  
  chrome.downloads.download({
    url: url,
    filename: filename,
    saveAs: true
  });
  
  updateStatus(`📄 CSV exported: ${filename}`);
}

function csvEscape(str) {
  if (!str) return '';
  str = String(str);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ─── Export to Excel (XLSX) ────────────────────────────────────────

function exportExcel() {
  if (leads.length === 0) return;
  
  // Build a simple XLSX using XML Spreadsheet format
  // This creates an Excel-compatible XML file that Excel/LibreOffice can open
  
  const headers = ['No', 'Name', 'Category', 'Rating', 'Reviews', 'Address', 'Phone', 'Website', 'Email', 'Hours', 'Price Level', 'URL', 'Latitude', 'Longitude'];
  
  let xml = '<?xml version="1.0"?>\n';
  xml += '<?mso-application progid="Excel.Sheet"?>\n';
  xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n';
  xml += '  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n';
  
  // Styles
  xml += '<Styles>\n';
  xml += '  <Style ss:ID="header">\n';
  xml += '    <Font ss:Bold="1" ss:Size="11"/>\n';
  xml += '    <Interior ss:Color="#34A853" ss:Pattern="Solid"/>\n';
  xml += '    <Font ss:Color="#FFFFFF" ss:Bold="1"/>\n';
  xml += '  </Style>\n';
  xml += '  <Style ss:ID="rating">\n';
  xml += '    <NumberFormat ss:Format="0.0"/>\n';
  xml += '  </Style>\n';
  xml += '</Styles>\n';
  
  // Worksheet
  xml += '<Worksheet ss:Name="Maps Leads">\n';
  xml += '<Table>\n';
  
  // Column widths
  xml += '<Column ss:Width="40"/>'; // No
  xml += '<Column ss:Width="200"/>'; // Name
  xml += '<Column ss:Width="120"/>'; // Category
  xml += '<Column ss:Width="60"/>'; // Rating
  xml += '<Column ss:Width="60"/>'; // Reviews
  xml += '<Column ss:Width="200"/>'; // Address
  xml += '<Column ss:Width="120"/>'; // Phone
  xml += '<Column ss:Width="180"/>'; // Website
  xml += '<Column ss:Width="160"/>'; // Email
  xml += '<Column ss:Width="100"/>'; // Hours
  xml += '<Column ss:Width="60"/>'; // Price
  xml += '<Column ss:Width="200"/>'; // URL
  xml += '<Column ss:Width="80"/>'; // Lat
  xml += '<Column ss:Width="80"/>'; // Lng
  xml += '\n';
  
  // Header row
  xml += '<Row>\n';
  for (const h of headers) {
    xml += `<Cell ss:StyleID="header"><Data ss:Type="String">${h}</Data></Cell>\n`;
  }
  xml += '</Row>\n';
  
  // Data rows
  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    xml += '<Row>\n';
    xml += `<Cell><Data ss:Type="Number">${i + 1}</Data></Cell>\n`;
    xml += `<Cell><Data ss:Type="String">${xmlEscape(lead.name)}</Data></Cell>\n`;
    xml += `<Cell><Data ss:Type="String">${xmlEscape(lead.category)}</Data></Cell>\n`;
    xml += `<Cell ss:StyleID="rating"><Data ss:Type="Number">${lead.rating || 0}</Data></Cell>\n`;
    xml += `<Cell><Data ss:Type="Number">${lead.reviews || 0}</Data></Cell>\n`;
    xml += `<Cell><Data ss:Type="String">${xmlEscape(lead.address)}</Data></Cell>\n`;
    xml += `<Cell><Data ss:Type="String">${xmlEscape(lead.phone)}</Data></Cell>\n`;
    xml += `<Cell><Data ss:Type="String">${xmlEscape(lead.website)}</Data></Cell>\n`;
    xml += `<Cell><Data ss:Type="String">${xmlEscape(lead.email)}</Data></Cell>\n`;
    xml += `<Cell><Data ss:Type="String">${xmlEscape(lead.hours)}</Data></Cell>\n`;
    xml += `<Cell><Data ss:Type="String">${xmlEscape(lead.priceLevel)}</Data></Cell>\n`;
    xml += `<Cell><Data ss:Type="String">${xmlEscape(lead.url)}</Data></Cell>\n`;
    xml += `<Cell><Data ss:Type="Number">${lead.lat || 0}</Data></Cell>\n`;
    xml += `<Cell><Data ss:Type="Number">${lead.lng || 0}</Data></Cell>\n`;
    xml += '</Row>\n';
  }
  
  xml += '</Table>\n';
  xml += '</Worksheet>\n';
  xml += '</Workbook>';
  
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob);
  
  const filename = `maps_leads_${new Date().toISOString().split('T')[0]}.xls`;
  
  chrome.downloads.download({
    url: url,
    filename: filename,
    saveAs: true
  });
  
  updateStatus(`📊 Excel exported: ${filename}`);
}

function xmlEscape(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── Event Listeners ───────────────────────────────────────────────

document.getElementById('btn-scrape').addEventListener('click', scrapeListings);
document.getElementById('btn-details').addEventListener('click', getDetails);
document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
document.getElementById('btn-export-xlsx').addEventListener('click', exportExcel);

document.getElementById('btn-clear').addEventListener('click', () => {
  leads = [];
  renderResults();
  updateStats();
  updateStatus('Cleared');
});

document.getElementById('btn-open-maps').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.google.com/maps' });
});

// Listen for progress updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SCROLL_PROGRESS') {
    const progressEl = document.getElementById('progress');
    progressEl.classList.add('active');
    const pct = Math.round((msg.scroll / msg.max) * 100);
    document.getElementById('progress-text').textContent = `📜 Scrolling... ${msg.scroll}/${msg.max}`;
    document.getElementById('progress-fill').style.width = `${pct}%`;
  }
  
  if (msg.type === 'DETAILS_PROGRESS') {
    const pct = Math.round((msg.current / msg.total) * 100);
    document.getElementById('progress-text').textContent = `📋 ${msg.name || ''} (${msg.current}/${msg.total})`;
    document.getElementById('progress-fill').style.width = `${pct}%`;
  }
});

// ─── Init ──────────────────────────────────────────────────────────

checkMapsPage();
