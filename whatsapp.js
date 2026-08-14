// Maps Lead Scraper — WhatsApp Web content script v3.5
// Runs on web.whatsapp.com. Receives commands from the side panel:
//   WA_PING  → report if the app is loaded & logged in
//   WA_SEND  → type chunks like a human and click send
// The first chunk is pre-filled via the ?text= URL param when the side
// panel navigates this tab to /send?phone=...&text=...

(() => {
  'use strict';

  const wait = ms => new Promise(r => setTimeout(r, ms));

  const INPUT_SEL = 'div[contenteditable="true"][data-tab="10"], div[role="textbox"][contenteditable="true"]';
  const QR_SEL = '[data-testid="qrcode"], canvas[aria-label="Scan me!"]';

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
    const btn = await waitFor('button[data-testid="send"]', 4000);
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

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

    if (msg.type === 'WA_PING') {
      sendResponse({ loggedIn: !!inputBox() });
      return true;
    }

    if (msg.type === 'WA_SEND') {
      (async () => {
        try {
          // Quick QR check (only ~1.5s if already logged in)
          const qr = await waitFor(QR_SEL, 1500);
          const input = await waitFor(INPUT_SEL, 40000);
          if (!input) {
            sendResponse({ ok: false, error: qr ? 'WA Web belum login — scan QR dulu' : 'Chat tidak terbuka / nomor tidak terdaftar' });
            return;
          }

          const chunks = Array.isArray(msg.chunks) ? msg.chunks : [];
          const prefill = msg.prefill || '';
          let sent = 0;

          // Chunk 0: already pre-filled via ?text= → just send it.
          const firstText = (input.textContent || '').trim();
          if (firstText) {
            if (await clickSend()) sent++;
            await wait(1500 + Math.random() * 1500);
          } else if (prefill) {
            await typeText(input, prefill);
            if (await clickSend()) sent++;
            await wait(1500 + Math.random() * 1500);
          }

          // Remaining chunks: type like a human, then send
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

  console.log('[Maps Lead Scraper] WhatsApp content script v3.5 ready');
})();
