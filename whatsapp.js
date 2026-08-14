// Maps Lead Scraper — WhatsApp Web content script v3.8.1
// Runs on web.whatsapp.com. Receives commands from the side panel:
//   WA_PING  → report if the app is loaded & logged in
//   WA_SEND  → attach images, type chunks like a human, click send
// Supports: text-only (prefilled via ?text= URL param or typed) and
// image + caption (attached via WA's hidden file input).

(() => {
  'use strict';

  const wait = ms => new Promise(r => setTimeout(r, ms));

  const INPUT_SEL = 'div[contenteditable="true"][data-tab="10"], div[role="textbox"][contenteditable="true"]';
  const QR_SEL = '[data-testid="qrcode"], canvas[aria-label="Scan me!"]';
  const PREVIEW_SEL = '[data-testid="image-attachment-border"], [data-testid="media-preview"]';
  const SEND_SEL = 'button[data-testid="send"], button[aria-label="Send"]';

  function inputBox() {
    return document.querySelector(INPUT_SEL);
  }

  async function waitFor(selector, timeout, predicate = () => true) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = document.querySelector(selector);
      if (el && predicate(el)) return el;
      await wait(250);
    }
    return null;
  }

  // Human-like typing: bursts of 3-8 chars with random pauses
  async function typeText(input, text) {
    input.focus();
    let i = 0;
    while (i < text.length) {
      const burst = 3 + Math.floor(Math.random() * 6);
      document.execCommand('insertText', false, text.slice(i, i + burst));
      i += burst;
      await wait(50 + Math.random() * 140);
    }
  }

  async function clickSend() {
    const btn = await waitFor(SEND_SEL, 4000);
    if (!btn) return false;
    btn.click();
    // Message is sent when the input box clears
    const start = Date.now();
    while (Date.now() - start < 8000) {
      const inp = inputBox();
      if (!inp || inp.textContent.trim() === '') return true;
      await wait(250);
    }
    return true;
  }

  // WA sometimes shows a dialog for unknown/unregistered numbers — accept it
  async function confirmIfNeeded(timeout = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const dlg = document.querySelector('div[role="dialog"]');
      if (dlg) {
        const btns = dlg.querySelectorAll('div[role="button"], button');
        for (const b of btns) {
          if (/ok|continue|lanjut|iya|ya/i.test(b.textContent || '')) {
            b.click();
            await wait(1200);
            return true;
          }
        }
      }
      await wait(400);
    }
    return false;
  }

  // ─── Image attachment ──────────────────────────────────────────

  function fileInput() {
    return document.querySelector('input[type="file"][accept*="image"]') || document.querySelector('input[type="file"]');
  }

  async function dataUrlToFile(dataUrl, name, type) {
    const blob = await (await fetch(dataUrl)).blob();
    return new File([blob], name || 'image.jpg', { type: type || blob.type || 'image/jpeg' });
  }

  async function attachImage(file) {
    const input = fileInput();
    if (!input) return false;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // Wait for the attachment preview / caption composer to appear
    const preview = await waitFor(PREVIEW_SEL + ', ' + SEND_SEL, 15000);
    return !!preview;
  }

  // The visible contenteditable is the caption box while in attachment preview
  function visibleContenteditable() {
    for (const el of document.querySelectorAll('div[contenteditable="true"]')) {
      const r = el.getBoundingClientRect();
      if (r.width > 80 && r.height > 10) return el;
    }
    return null;
  }

  async function sendImageWithCaption(caption) {
    const box = visibleContenteditable();
    if (box && caption) await typeText(box, caption);
    const btn = await waitFor(SEND_SEL, 5000);
    if (!btn) return false;
    btn.click();
    // Wait until the preview is gone (image sent)
    const start = Date.now();
    while (Date.now() - start < 15000) {
      if (!document.querySelector(PREVIEW_SEL)) return true;
      await wait(300);
    }
    return true;
  }

  // ─── Message handler ───────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

    if (msg.type === 'WA_PING') {
      // Deteksi login: input chat terbuka ATAU shell aplikasi (chat list / tombol new chat).
      // Catatan: di layar utama (tanpa chat terbuka) kotak input TIDAK ada — jangan salah
      // dianggap belum login hanya karena input box tidak ditemukan.
      const shell = !!document.querySelector('button[data-testid="chat"], #side, div[data-testid="chat-list"], div[aria-label="Main menu"]');
      sendResponse({ loggedIn: !!inputBox() || shell });
      return true;
    }

    if (msg.type === 'WA_SEND') {
      (async () => {
        try {
          const qr = await waitFor(QR_SEL, 1500);
          await confirmIfNeeded(6000); // accept unknown-number prompt if shown
          const input = await waitFor(INPUT_SEL, 30000);
          if (!input) {
            sendResponse({ ok: false, error: qr ? 'login dulu (scan QR)' : 'nomor tidak terdaftar / chat tidak terbuka' });
            return;
          }

          const chunks = Array.isArray(msg.chunks) ? msg.chunks : [];
          const prefill = msg.prefill || '';
          const images = Array.isArray(msg.images) ? msg.images : [];
          let sent = 0;

          if (images.length) {
            // Attach each image; the first chunk becomes the caption
            for (const img of images) {
              const file = await dataUrlToFile(img.dataUrl, img.name, img.type);
              if (await attachImage(file)) {
                if (await sendImageWithCaption(sent === 0 ? prefill : '')) sent++;
                await wait(2000 + Math.random() * 2000);
              }
            }
          } else {
            // Text-only: send prefilled (from ?text=) or type the first chunk
            const firstText = (input.textContent || '').trim();
            if (firstText) {
              if (await clickSend()) sent++;
            } else if (prefill) {
              await typeText(input, prefill);
              if (await clickSend()) sent++;
            }
            await wait(1500 + Math.random() * 1500);
          }

          // Remaining chunks as separate short text messages (human-like)
          for (const chunk of chunks) {
            const inp = inputBox();
            if (!inp) break;
            await typeText(inp, chunk);
            if (!(await clickSend())) break;
            sent++;
            await wait(2000 + Math.random() * 2500);
          }

          sendResponse({ ok: true, sent });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;
    }
  });

  console.log('[Maps Lead Scraper] WhatsApp content script v3.7 ready');
})();
