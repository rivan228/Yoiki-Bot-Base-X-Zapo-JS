// plugins/tools/webscrape.js
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

// Helper: Cegah serangan SSRF (Server-Side Request Forgery) ke jaringan lokal Pterodactyl
function isBlockedTarget(urlStr) {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();

    // Blokir protokol berbahaya selain http/https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;

    // Blokir IP lokal / metadata internal cloud
    if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host)) return true;
    if (host.startsWith('192.168.') || host.startsWith('10.') || host.startsWith('169.254.')) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;

    return false;
  } catch (_) {
    return true;
  }
}

// Fungsi utama eksekusi
const execute = async (m, context) => {
  const sock = context?.sock || context?.Cantarella || global.sock;
  const args = context?.args || (m.text ? m.text.trim().split(/\s+/).slice(1) : []);

  // Helper kirim pesan respons anti-gagal
  const sendReply = async (text) => {
    try {
      if (typeof m.reply === 'function') return await m.reply(text);
      return await sock.message.send(m.chat, { text }, { quoted: m });
    } catch (_) {
      try {
        return await sock.message.send(m.chat, { text });
      } catch (e) {
        console.error('[WebScrape] Gagal kirim balasan:', e.message);
      }
    }
  };

  const rawInput = args.join(' ').trim();

  // 1. Tampilkan panduan jika tanpa argumen
  if (!rawInput) {
    return await sendReply(
      `🌐 *WEB SCRAPER & EXTRACTOR PRO*\n\n` +
      `*Cara Penggunaan:*\n` +
      `> \`.scrape <url>\` — Ekstrak judul, deskripsi & teks artikel\n` +
      `> \`.scrape <url> | <selector>\` — Ambil elemen CSS tertentu\n` +
      `> \`.scrape <url> --html\` — Ambil source code HTML utuh\n` +
      `> \`.scrape <url> --links\` — Kumpulkan semua link di halaman\n` +
      `> \`.scrape <url> --images\` — Kumpulkan link gambar di halaman\n\n` +
      `*Contoh Nyata:*\n` +
      `• \`.scrape https://id.wikipedia.org/wiki/JavaScript\`\n` +
      `• \`.scrape https://news.ycombinator.com | .titleline\`\n` +
      `• \`.scrape https://example.com --html\``
    );
  }

  // 2. Parsing URL, flags, dan opsi selector
  let targetUrl = '';
  let selector = '';
  let mode = 'text'; // 'text' | 'html' | 'links' | 'images' | 'selector'

  if (rawInput.includes('--html')) {
    mode = 'html';
    targetUrl = rawInput.replace('--html', '').trim();
  } else if (rawInput.includes('--links')) {
    mode = 'links';
    targetUrl = rawInput.replace('--links', '').trim();
  } else if (rawInput.includes('--images')) {
    mode = 'images';
    targetUrl = rawInput.replace('--images', '').trim();
  } else if (rawInput.includes('|')) {
    mode = 'selector';
    const [u, ...s] = rawInput.split('|');
    targetUrl = u.trim();
    selector = s.join('|').trim();
  } else {
    const parts = rawInput.split(/\s+/);
    targetUrl = parts[0];
    if (parts.length > 1) {
      mode = 'selector';
      selector = parts.slice(1).join(' ').trim();
    }
  }

  // Otomatis tambahkan http jika user lupa mengetikkan
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = `https://${targetUrl}`;
  }

  // 3. Validasi Keamanan URL
  if (isBlockedTarget(targetUrl)) {
    return await sendReply('❌ *Akses Ditolak:* Tautan tidak valid atau dilarang (akses jaringan lokal diblokir demi keamanan server).');
  }

  await sendReply(`🔍 *Menghubungi dan memindai web:* \n\`${targetUrl}\`...`);

  let tempFilePath = null;

  try {
    const startTime = Date.now();

    // 4. Request halaman web dengan header browser realistis
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'DNT': '1'
      },
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const contentType = response.headers['content-type'] || '';

    // Kasus Khusus: Jika target berupa REST API / JSON langsung
    if (contentType.includes('application/json') || typeof response.data === 'object') {
      const jsonString = JSON.stringify(response.data, null, 2);
      if (jsonString.length <= 3500) {
        return await sendReply(
          `📄 *HASIL SCRAPE (REST API JSON)*\n` +
          `⏱️ Waktu: ${elapsed}s | Status: ${response.status}\n\n` +
          `\`\`\`json\n${jsonString}\n\`\`\``
        );
      }

      // Jika JSON terlalu besar, kirim sebagai dokumen .json
      const tmpDir = path.resolve('./tmp');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      tempFilePath = path.join(tmpDir, `api_${Date.now()}.json`);
      fs.writeFileSync(tempFilePath, jsonString, 'utf8');

      return await sock.message.send(
        m.chat,
        {
          type: 'document',
          media: tempFilePath,
          fileName: `result_${Date.now()}.json`,
          mimetype: 'application/json',
          caption: `📄 *HASIL SCRAPE (JSON FILE)*\n• URL: ${targetUrl}\n• Ukuran: ${(Buffer.byteLength(jsonString) / 1024).toFixed(2)} KB\n• Waktu: ${elapsed}s`
        },
        { quoted: m }
      );
    }

    const html = String(response.data || '');
    const $ = cheerio.load(html);

    // 5. Eksekusi sesuai mode pilihan

    // Mode A: Raw HTML
    if (mode === 'html') {
      if (html.length <= 3500) {
        return await sendReply(
          `🌐 *SOURCE CODE HTML*\n` +
          `⏱️ Waktu: ${elapsed}s\n\n` +
          `\`\`\`html\n${html.slice(0, 3400)}\n\`\`\``
        );
      }

      const tmpDir = path.resolve('./tmp');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const hostName = new URL(targetUrl).hostname.replace(/[^a-zA-Z0-9]/g, '_');
      tempFilePath = path.join(tmpDir, `${hostName}_${Date.now()}.html`);
      fs.writeFileSync(tempFilePath, html, 'utf8');

      return await sock.message.send(
        m.chat,
        {
          type: 'document',
          media: tempFilePath,
          fileName: `${hostName}.html`,
          mimetype: 'text/html',
          caption: `🌐 *SOURCE CODE HTML UTUH*\n• URL: ${targetUrl}\n• Ukuran: ${(Buffer.byteLength(html) / 1024).toFixed(2)} KB\n• Waktu: ${elapsed}s`
        },
        { quoted: m }
      );
    }

    // Mode B: CSS Selector Query (misal: h1, .title, table, dll)
    if (mode === 'selector') {
      const selected = $(selector);
      if (!selected.length) {
        return await sendReply(`❌ Tidak ada elemen yang cocok dengan selector: \`${selector}\``);
      }

      const items = [];
      selected.each((i, el) => {
        if (i < 20) {
          const t = $(el).text().replace(/\s+/g, ' ').trim();
          if (t) items.push(`${i + 1}. ${t}`);
        }
      });

      if (!items.length) {
        return await sendReply(`⚠️ Elemen ditemukan (${selected.length}), tetapi tidak berisi teks.`);
      }

      const selectorResultText =
        `🎯 *HASIL QUERY SELECTOR: \`${selector}\`*\n` +
        `• Ditemukan: *${selected.length} elemen*\n` +
        `• Waktu: ${elapsed}s\n\n` +
        `${items.join('\n\n')}` +
        `${selected.length > 20 ? `\n\n_...dan ${selected.length - 20} elemen lainnya_` : ''}`;

      return await sendReply(selectorResultText);
    }

    // Mode C: Ekstrak Semua Link (<a>)
    if (mode === 'links') {
      const links = new Set();
      $('a[href]').each((_, el) => {
        const h = $(el).attr('href');
        try {
          const abs = new URL(h, targetUrl).href;
          if (abs.startsWith('http')) links.add(abs);
        } catch (_) {}
      });

      const linkList = [...links];
      if (!linkList.length) return await sendReply('❌ Tidak ditemukan tautan link di halaman web ini.');

      const outputLinks = linkList
        .slice(0, 25)
        .map((l, i) => `${i + 1}. ${l}`)
        .join('\n');

      return await sendReply(
        `🔗 *DAFTAR LINK DI HALAMAN*\n` +
        `• Total Link: *${linkList.length} tautan*\n` +
        `• Waktu: ${elapsed}s\n\n` +
        `${outputLinks}` +
        `${linkList.length > 25 ? `\n\n_...dan ${linkList.length - 25} tautan lainnya_` : ''}`
      );
    }

    // Mode D: Ekstrak Semua Gambar (<img>)
    if (mode === 'images') {
      const images = new Set();
      $('img[src]').each((_, el) => {
        const s = $(el).attr('src') || $(el).attr('data-src');
        try {
          const abs = new URL(s, targetUrl).href;
          if (abs.startsWith('http')) images.add(abs);
        } catch (_) {}
      });

      const imgList = [...images];
      if (!imgList.length) return await sendReply('❌ Tidak ada gambar ditemukan di halaman web ini.');

      const outputImgs = imgList
        .slice(0, 20)
        .map((img, i) => `${i + 1}. ${img}`)
        .join('\n');

      return await sendReply(
        `🖼️ *DAFTAR GAMBAR DI HALAMAN*\n` +
        `• Total Gambar: *${imgList.length} berkas*\n` +
        `• Waktu: ${elapsed}s\n\n` +
        `${outputImgs}` +
        `${imgList.length > 20 ? `\n\n_...dan ${imgList.length - 20} gambar lainnya_` : ''}`
      );
    }

    // Mode Default: Smart Content & Article Extractor
    const title = $('title').text().trim() || $('meta[property="og:title"]').attr('content') || '-';
    const description = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '-';
    const ogImage = $('meta[property="og:image"]').attr('content') || null;

    // Bersihkan script, style, navigation dari teks artikel
    $('script, style, noscript, nav, header, footer, svg, iframe').remove();

    // Ambil konten utama
    let mainContent = $('article, main, .content, #content, .post, .entry-content').text().replace(/\s+/g, ' ').trim();
    if (!mainContent || mainContent.length < 50) {
      mainContent = $('body').text().replace(/\s+/g, ' ').trim();
    }

    // Batasi cuplikan artikel
    const snippet = mainContent.length > 1200 ? mainContent.slice(0, 1200) + '...' : (mainContent || 'Tidak ada teks isi utama yang terbaca.');

    const summaryText =
      `🌐 *WEB SCRAPER SUMMARY*\n\n` +
      `╭┈┈⬡「 📋 *METADATA* 」\n` +
      `┃ • *URL:* ${targetUrl}\n` +
      `┃ • *Judul:* ${title}\n` +
      `┃ • *Deskripsi:* ${description.slice(0, 180)}\n` +
      `┃ • *Waktu Respon:* ${elapsed}s\n` +
      `╰┈┈┈┈┈┈┈┈⬡\n\n` +
      `╭┈┈⬡「 📖 *CUPLIKAN KONTEN* 」\n` +
      `┃\n` +
      `┃ ${snippet}\n` +
      `┃\n` +
      `╰┈┈┈┈┈┈┈┈⬡\n\n` +
      `_Gunakan \`.scrape ${targetUrl} --html\` untuk kode lengkap._`;

    // Jika memiliki thumbnail OpenGraph, kirim menggunakan format media zapo-js
    if (ogImage && /^https?:\/\//i.test(ogImage)) {
      try {
        return await sock.message.send(
          m.chat,
          {
            type: 'image',
            media: ogImage,
            caption: summaryText
          },
          { quoted: m }
        );
      } catch (_) {
        // Fallback ke teks jika gambar gagal diunduh WhatsApp
      }
    }

    await sendReply(summaryText);

  } catch (err) {
    console.error('[WebScrape Error]:', err);
    let errMsg = err.message || 'Terjadi kesalahan saat memproses.';
    if (err.response?.status) {
      errMsg = `HTTP Error ${err.response.status} (${err.response.statusText || 'Gagal memuat web'})`;
    } else if (err.code === 'ECONNABORTED') {
      errMsg = 'Request Timeout (Web target terlalu lambat merespon lebih dari 30 detik).';
    } else if (err.code === 'ENOTFOUND') {
      errMsg = 'Domain web tidak ditemukan. Pastikan alamat URL benar.';
    }
    await sendReply(`❌ *Gagal melakukan scrape website:*\n> ${errMsg}`);
  } finally {
    // 6. Pembersihan file temporary di ./tmp/ container Pterodactyl
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (_) {}
    }
  }
};

// -------------------------------------------------------------
// UNIVERSAL EXPORT (Mendukung semua loader bot Zapo-JS & Baileys)
// -------------------------------------------------------------
export const config = {
  name: ['scrape', 'webscrape', 'fetchweb', 'gethtml', 'crawling'],
  command: 'scrape',
  alias: ['webscrape', 'fetchweb', 'gethtml', 'crawling'],
  category: 'tools',
  description: 'Scrape dan ekstrak teks, HTML, link, atau gambar dari website apapun',
  onlyOwner: false
};

export const handler = execute;
export const run = execute;

export default {
  command: 'scrape',
  name: ['scrape', 'webscrape', 'fetchweb', 'gethtml', 'crawling'],
  alias: ['webscrape', 'fetchweb', 'gethtml', 'crawling'],
  category: 'tools',
  description: 'Scrape dan ekstrak teks, HTML, link, atau gambar dari website apapun',
  onlyOwner: false,
  execute,
  run: execute,
  handler: execute
};