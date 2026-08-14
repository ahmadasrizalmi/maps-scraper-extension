# Maps Lead Scraper — Chrome Extension

Scrape business leads from Google Maps (name, category, rating, address, phone, website, email) via a sidebar panel. Export to CSV or Google Sheets (clipboard paste).

## Fitur

- **Scrape Listing** — ambil semua hasil pencarian dari sidebar Google Maps
- **Get details** — klik tiap listing → ambil detail dari panel (alamat, telepon, website) → kembali
- **Extract emails** — scan homepage + halaman kontak website bisnis untuk menemukan email
- **Deduplicate** — hilangkan duplikat berdasarkan nama
- **Filter & sort** — cari, filter rating, filter "punya phone/website/email", sort per kolom
- **Auto-scroll** — scroll feed hasil pencarian secara otomatis (jumlah scroll adaptif)
- **Export CSV / Google Sheets** — satu klik, format aman untuk Excel & Sheets
- **Save/Load** — hasil scrape tersimpan di `chrome.storage.local`

## Instalasi (Load unpacked)

1. Buka `chrome://extensions`
2. Aktifkan **Developer mode** (pojok kanan atas)
3. Klik **Load unpacked** → pilih folder ini
4. Buka [Google Maps](https://www.google.com/maps), cari bisnis, lalu klik ikon extension untuk membuka side panel

## Cara pakai

1. Di Google Maps, lakukan pencarian (mis. `restoran di Jakarta`)
2. Buka side panel extension
3. Centang opsi yang diinginkan:
   - **Auto-scroll** — scroll sampai semua hasil termuat (perlu jika ada > 20 hasil)
   - **Get details** — ambil alamat/telepon/website dari panel detail tiap bisnis
   - **Extract emails** — cari email di website bisnis (membutuhkan koneksi internet & waktu lebih lama)
   - **Deduplicate** — gabungkan hasil duplikat
4. Set **Max listings** jika ingin batasi jumlah (0 = semua)
5. Klik **Scrape Listings** dan tunggu sampai selesai
6. Export via **CSV** atau **Sheets** (paste `Ctrl+V` di Google Sheets)

> **Catatan:** untuk hasil yang lebih banyak, scroll manual dulu sampai feed menunjukkan semua hasil, lalu matikan opsi Auto-scroll.

## Struktur file

```
├── manifest.json    # Manifest V3 — permissions, content script, side panel
├── background.js    # Service worker — buka side panel, set panel enabled di Maps
├── content.js       # Content script — scroll, scrape, detail, ekstraksi email
├── sidepanel.html   # UI side panel
├── sidepanel.js     # Logika UI — filter, sort, export, save/load
└── icons/           # Ikon 16/48/128px
```

## Arsitektur & alur kerja

```
Google Maps tab
  │  content.js (disuntik di google.com/maps/*)
  │    1. autoScroll()          → scroll feed hasil
  │    2. scrapeListings()      → baca kartu [role="article"] dari DOM
  │    3. processOneListing()   → klik tiap listing, baca panel detail, Back
  │    4. extractEmail()        → fetch website bisnis, cari email
  │       │
  │       ▼ chrome.runtime.sendMessage (PROGRESS)
  └──► sidepanel (sidepanel.html + sidepanel.js)
         render tabel, filter, sort, export CSV/Sheets
```

## Optimasi v3.3 (riwayat perubahan)

### Kecepatan detail scraping (~3× lebih cepat)
- **`MutationObserver` menggantikan polling tetap**: menunggu panel detail (`.DUwDvf`) dan menunggu panel hilang saat Back sekarang resolve segera saat elemen muncul/hilang, bukan polling 300ms × 15 (maks 4,5 detik).
- Scroll panel detail memakai langkah lebih besar (600px @ 40ms, sebelumnya 300px @ 80ms).
- Estimasi: 3–7 detik/listing → **1–2 detik/listing**.

### Ekstraksi email (paralel + cache)
- **Lazy probing**: fetch homepage dulu; halaman `/contact`, `/about`, `/kontak`, `/hubungi` hanya di-fetch jika homepage tidak mengandung email.
- **6 worker paralel** menggantikan eksekusi serial (sebelumnya 5 request berurutan per lead, maks 20s/lead).
- **Cache per-domain** — domain yang sama tidak di-fetch ulang.
- **Strip `<script>/<style>`** sebelum regex — mengurangi false positive (email di kode JS/CSS).
- Timeout diturunkan 4s → 3,5s per halaman.

### Auto-scroll adaptif
- Sebelumnya jeda tetap 1500ms per scroll. Sekarang menunggu tinggi feed **stabil ~600ms** (resolve lebih cepat saat konten cepat termuat), dengan cap 2,5s agar tidak macet.

### Pengurangan beban message
- **Throttle PROGRESS** ke ~4 pesan/detik (sebelumnya 1 pesan per listing) — mengurangi wake-up background + side panel.
- **Background**: hapus listener `onMessage` mati yang `return true` tanpa `sendResponse` — menyebabkan channel message tidak pernah ditutup (port leak).

### UI side panel
- **`WeakMap` index** menggantikan `leads.indexOf()` di dalam loop render → render O(n), bukan O(n²). Dengan 1.000 lead, dari ~1 juta lookup menjadi 1.000.
- **Search debounce 150ms** — tabel tidak di-rebuild ulang setiap ketukan tombol.
- **rAF-throttle** untuk rendering progress.
- **`URL.revokeObjectURL()`** setelah download — mencegah kebocoran memori saat export berulang.

## Catatan keamanan & keterbatasan

- `host_permissions` berisi `https://*/*` — dibutuhkan untuk fitur ekstraksi email (fetch ke website bisnis mana pun). Permissions yang luas berarti extension dapat mengakses halaman apa pun yang Anda buka; pastikan hanya dipasang dari sumber tepercaya.
- Selector DOM Google Maps (`[role="article"]`, `.DUwDvf`, `.MW4etd`, dll.) dapat berubah kapan saja oleh Google dan perlu diverifikasi ulang.
- Kategori & alamat hasil dari kartu listing diestimasi secara heuristik (berdasarkan pola teks) — bisa kurang akurat untuk bahasa/lokasi tertentu.
- Ekstraksi email bergantung pada CORS; website yang menolak `fetch` lintas-origin (tanpa header CORS) tidak akan terbaca — karena `host_permissions` luas, Chrome umumnya mengizinkan.

## Lisensi

Lihat repository asli: https://github.com/ahmadasrizalmi/maps-scraper-extension
