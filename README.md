# Maps Lead Scraper — Chrome Extension

Scrape business leads from Google Maps (name, category, rating, address, phone, website, email) via a sidebar panel. Export to CSV or Google Sheets (clipboard paste).

## Fitur

- **Scrape Listing** — ambil semua hasil pencarian dari sidebar Google Maps
- **Get details** — klik tiap listing → ambil detail dari panel (alamat, telepon, website) → kembali
- **Extract emails** — cari email di website bisnis (diekstrak di side panel, bebas CORS)
- **Follow up WhatsApp** — buka chat WA tiap lead (`wa.me`) dengan urutan acak + jeda acak anti-ban
- **Auto-send WA via AI** — mode Auto mengetik & mengirim pesan di WhatsApp Web; pesan dipersonalisasi per bisnis oleh DeepSeek (`deepseek-v4-flash`), dipotong jadi beberapa pesan pendek seperti manusia
- **Kirim gambar** — lampirkan 1+ gambar bersama pesan
- **Pesan tersusun otomatis** — input jasa/produk, link portfolio, nama pengirim, gaya bahasa → AI merangkai pesan
- **Monitoring** — hitungan terkirim/gagal live + laporan akhir
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
   - **Extract emails** — cari email di website bisnis (berjalan setelah scrape, di side panel)
   - **Deduplicate** — gabungkan hasil duplikat
4. Set **Max listings** jika ingin batasi jumlah (0 = semua)
5. Klik **Scrape Listings** dan tunggu sampai selesai
6. Export via **CSV** atau **Sheets** (paste `Ctrl+V` di Google Sheets), atau
7. **Follow up WA** — atur jeda acak antar chat (detik), klik **Follow up WA**; setiap chat dibuka di tab baru secara acak & berjeda. **Stop** untuk menghentikan antrian.

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
  │    3. processOneListing()   → klik tiap listing, baca panel detail (phone robust), Back
  │       │
  │       ▼ chrome.runtime.sendMessage (PROGRESS + hasil)
  └──► sidepanel (sidepanel.html + sidepanel.js)
         render tabel, filter, sort, export CSV/Sheets
         ekstraksi email (fetch bebas CORS — extension page)
         follow-up WhatsApp (wa.me + jeda acak)
```

## v3.8.3 — Penyimpanan settings bulletproof + tombol Simpan

- **Tombol "💾 Simpan Pengaturan"** eksplisit di tab Pengaturan + indikator "✓ Tersimpan jam:menit:detik".
- Save otomatis di **banyak titik**: saat mengetik (300ms), saat blur/change, saat pindah tab, dan saat panel ditutup (`beforeunload`).
- **Anti-interferensi autofill**: `autocomplete="new-password"` + tombol 👁 lihat/sembunyikan key (password manager kadang mengosongkan field password).
- Log ke console (`[Settings] tersimpan` / `GAGAL menyimpan`) supaya kalau ada error bisa terlihat.
- Jika setelah update ini key masih hilang, cek console (F12 di side panel): kalau ada `GAGAL menyimpan`, itu indikasi masalah permission storage.

## v3.8.2 — Auto-save settings, status login WA persisten, unlimited storage

- **Settings auto-save**: API key, model, jasa/produk, gaya bahasa, dll. tersimpan otomatis saat diketik (400ms setelah berhenti mengetik) + indikator "✓ Tersimpan" — tidak perlu tombol Save, tidak perlu input ulang.
- **Status login WA persisten**: hasil cek login disimpan; tampil otomatis di tab Pengaturan & Kirim. Auto-cek (tanpa reload) setiap kali tab Kirim/Pengaturan dibuka.
- **`unlimitedStorage`**: hapus batas 10MB chrome.storage — data lead, history, sesi aman dalam jumlah besar.

## v3.8 — Riwayat sesi & history per lead

Sebelumnya setiap lead hanya menyimpan **status terakhir + tanggal kirim terakhir** — sesi follow-up yang berbeda tercampur. Sekarang:

- **History per lead** (`lead.history`): daftar event berurutan (`kirim`, `followup`, `dibalas`, `invalid`, `skip`) dengan tanggal. Lihat dengan mengarahkan kursor ke nama bisnis di tab Leads (tooltip).
- **Riwayat sesi** (tab baru): setiap run pengiriman tercatat — tanggal, mode (target baru / follow-up), terkirim/gagal/total. Tersimpan maks 50 sesi terakhir, bisa dikosongkan.
- Tetap tersimpan di `chrome.storage.local` (tanpa server).

## v3.7 — Desain ulang total (alur: Kumpulkan → Saring → Kirim → Lacak → Follow-up)

### Audit fitur (yang tidak berfungsi disingkirkan)
- ❌ **Google Sheets / Excel export dihapus** (tidak berfungsi / tidak pernah ada) — hanya **CSV** (kini dengan kolom Status & Tanggal Kirim).
- ❌ **Checkbox Auto-scroll / Get details / Deduplicate dihapus** — selalu aktif secara default.
- ❌ **Tombol Save/Load dihapus** — data tersimpan otomatis setiap saat.
- ❌ **Mode Auto/Manual dihapus** — kirim otomatis jika WA Web login; tombol WA per baris tetap tersedia untuk manual.

### UX baru: 3 tab
| Tab | Isi |
|---|---|
| **Leads** | Scrape, statistik (Total/Baru/Terkirim/Dibalas), filter (cari + status), tabel dengan **status per lead**, export CSV, hapus invalid |
| **Kirim** | 1) Pilih target (Baru / Follow-up belum dibalas ≥ N hari) 2) Susun pesan (pengirim, jasa/produk, link, gaya bahasa, pesan manual opsional, **Preview contoh pesan**) 3) Kirim (gambar, jeda acak, batas harian, progress Terkirim/Gagal/Total) |
| **Pengaturan** | API key DeepSeek, model, jeda antar chunk, batas harian, tombol Login WA Web + status |

### Logika status (satu sumber kebenaran)
- Setiap lead: `baru` → `terkirim` (tanggal) → `dibalas` / `invalid` / `skip` — disimpan otomatis di storage.
- Target kirim hanya `baru` (atau `terkirim` yang sudah ≥ N hari & belum dibalas) — **tidak pernah kirim ulang ke orang yang sama**.
- Gagal kirim → `invalid` (tidak dicoba lagi). `dibalas`/`skip` tidak pernah dikirim.
- Pesan follow-up di-generate berbeda dari pesan pertama (LLM diberi konteks tindak lanjut).
- Pesan manual didukung dengan placeholder `{nama}`; preview bisa dicek sebelum kirim.

## Optimasi v3.6 (input gambar, settings AI terstruktur, monitoring)

### Input gambar
- Pilih 1+ gambar di settings → dikirim sebagai lampiran WA bersama pesan (gambar pertama jadi caption).
- Gambar di-attach via input file tersembunyi WhatsApp Web (`DataTransfer`), menunggu preview muncul, ketik caption, kirim.
- Batas: ukuran wajar (< 16MB), format jpg/png/webp/heic.

### Settings AI terstruktur (menggantikan "instruksi" bebas)
- **Jasa/produk yang ditawarkan** — isi apa yang mau ditawarkan, LLM merangkai kalimatnya.
- **Link web/portfolio** — disertakan dalam pesan.
- **Nama pengirim** — identitas pengirim.
- **Gaya bahasa** — pilihan: Ramah, Formal, Profesional, Persuasif, Singkat.
- LLM (`deepseek-v4-flash`, non-thinking) menyusun pesan dari semua input + data lead (nama bisnis, kategori, alamat).

### Monitoring pengiriman
- Progress bar menampilkan `Terkirim X · Gagal Y · Total Z` secara live.
- Laporan akhir permanen di baris WA (hijau) + toast ringkasan.
- Gagal dicatat dengan alasan di console (mis. "nomor tidak terdaftar / chat tidak terbuka").

### Deteksi nomor yang terdaftar di WhatsApp
- Validasi penuh gratis tidak tersedia (butuh WhatsApp Business API berbayar), jadi validasi dilakukan **inline saat kirim**: nomor yang chat-nya tidak terbuka (tidak terdaftar) ditandai gagal & dilewati, lalu muncul di laporan.
- Dialog "nomor tidak dikenal" otomatis di-OK-kan supaya tidak memblokir antrian.

## Optimasi v3.5 (auto-send WhatsApp + AI DeepSeek)

### Fitur baru
- **Mode Auto (ketik & kirim):** content script baru `whatsapp.js` berjalan di `web.whatsapp.com`. Side panel menavigasi tab WA Web ke `/send?phone=…&text=…`, lalu `whatsapp.js` mengirim chunk pertama, mengetik sisa pesan karakter demi karakter (kecepatan manusia), dan mengirim dengan jeda acak antar chunk.
- **Pesan personal via DeepSeek:** jika API key diisi, setiap pesan di-generate per bisnis (nama, kategori, alamat) dengan model `deepseek-v4-flash` mode non-thinking (`thinking: {type:"disabled"}`). Tanpa key → fallback template bawaan.
- **Split teks:** pesan panjang dipecah menjadi chunk 150–300 karakter di batas kalimat — beberapa pengiriman pendek, bukan 1 pesan panjang.
- **Batas harian** (`wa-cap`): anti-ban — berhenti otomatis setelah N kontak per hari (tersimpan per tanggal).
- **Settings UI:** API key, nama pengirim, model, instruksi pesan, jeda antar chunk, batas harian, mode Auto/Manual — tersimpan di `chrome.storage`.

### Catatan penggunaan mode Auto
- Wajib login WhatsApp Web di tab browser (scan QR sekali).
- Tab WA dibuat/dipakai otomatis; navigasi antar kontak terjadi di tab tersebut.
- Nomor yang tidak terdaftar di WhatsApp dilewati (chat tidak terbuka).
- Risiko ban tetap ada pada auto-send — gunakan jeda antar kontak yang cukup (45–120s) dan batas harian wajar.

## Optimasi v3.4 (perbaikan phone, email & fitur WhatsApp)

### Perbaikan nomor HP yang gagal di-scrape
- Google Maps meng-obfuscate digit nomor HP dengan karakter unicode private-use (rentang U+E000–U+F8FF) — glyph terlihat angka tapi bukan karakter `0-9`, sehingga regex lama gagal cocok. Sekarang karakter PUA **di-strip dulu** sebelum parsing.
- Nomor yang tersembunyi di balik tombol kini di-**klik untuk reveal**, lalu di-parse ulang (DOM di-query ulang setelah klik).
- Fallback terakhir: scan teks panel detail/dialog untuk pola nomor (minimal 9 digit).

### Perbaikan email yang selalu gagal (bug arsitektur)
- **Akar masalah:** `fetch()` dari content script tunduk pada kebijakan CORS halaman Google Maps. Host permission `https://*/*` **tidak** melewati CORS untuk content script — hanya untuk halaman extension. Website bisnis yang tidak mengirim header CORS → request ditolak → email selalu kosong.
- **Solusi:** ekstraksi email dipindah ke **side panel** (extension page) yang fetch-nya bebas CORS. Tetap paralel (6 worker), cache per-domain, lazy probe halaman `/contact` dll, strip `<script>/<style>`.

### Fitur follow-up WhatsApp (anti-ban)
- **Kolom WA** di tabel + tombol **Follow up WA** untuk semua lead.
- Nomor dinormalisasi ke format internasional (`08xx…` → `628xx…`) — ikut diekspor di kolom **WhatsApp** pada CSV/Sheets.
- Antrian membuka chat `wa.me` dengan **urutan di-acak (shuffle)** dan **jeda acak** antar chat (default 45–120 detik, bisa diatur) supaya polanya tidak terlihat robotik. Tombol **Stop** untuk menghentikan.
- **Penting:** fitur ini hanya *membuka chat* — pengiriman pesan tetap manual oleh user. Ini jauh lebih aman dari ban dibanding auto-send. Untuk volume besar tetap disarankan jeda lebih lama dan batasi jumlah per hari.

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
