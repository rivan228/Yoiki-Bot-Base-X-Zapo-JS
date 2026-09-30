// plugins/downloader/tiktok.js
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

const BASE = 'https://ssstik.io';
const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36';

const client = axios.create({
  timeout: 90000,
  headers: {
    'User-Agent': UA,
    'Accept': '*/*',
    'Accept-Language': 'en-GB,en;q=0.9,id-ID;q=0.8'
  },
  validateStatus: s => s < 600,
  transformResponse: [v => v]
});

function decodeB64Url(str) {
  try {
    const padded = str + '='.repeat((4 - str.length % 4) % 4);
    return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch (_) {
    return null;
  }
}

async function initSession() {
  const r = await client.get(BASE + '/');
  const html = String(r.data);
  const token = (html.match(/s_tt\s*=\s*['"]([^'"]+)['"]/) || [])[1] || '';
  const sc = r.headers['set-cookie'] || [];
  const cookieJar = sc.map(c => c.split(';')[0]).join('; ');
  if (!token) throw new Error('Gagal mendapatkan token s_tt dari SSSTik.');
  return { token, cookieJar };
}

async function resolveShortUrl(url) {
  if (!/vt\.tiktok\.com|vm\.tiktok\.com|tiktok\.com\/t\//i.test(url)) return url;
  try {
    const r = await axios.get(url, {
      maxRedirects: 0,
      timeout: 15000,
      headers: { 'User-Agent': UA },
      validateStatus: s => s < 400
    });
    if (r.headers?.location) return r.headers.location;
  } catch (e) {
    if (e.response?.headers?.location) return e.response.headers.location;
  }
  return url;
}

async function scrapeSsstik(tiktokUrl) {
  const { token, cookieJar: initialCookie } = await initSession();
  let cookieJar = initialCookie;
  const resolved = await resolveShortUrl(tiktokUrl);

  const body = new URLSearchParams({
    id: resolved,
    locale: 'en',
    tt: token
  }).toString();

  const headers = {
    'User-Agent': UA,
    'Accept': '*/*',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Hx-Current-Url': BASE + '/',
    'Hx-Request': 'true',
    'Hx-Target': 'target',
    'Hx-Trigger': '_gcaptcha_pt',
    'Origin': BASE,
    'Referer': BASE + '/'
  };
  if (cookieJar) headers['Cookie'] = cookieJar;

  const r = await client.post(BASE + '/abc?url=dl', body, { headers });
  const setCookie = r.headers['set-cookie'] || [];
  if (setCookie.length) {
    cookieJar += '; ' + setCookie.map(c => c.split(';')[0]).join('; ');
  }

  const html = String(r.data);
  if (!html || html.length < 100) {
    throw new Error('Respon SSSTik kosong atau diblokir.');
  }

  const $ = cheerio.load(html);

  const result = {
    author: $('.result_author').length ? $('h2').first().text().trim() : 'Unknown',
    title: $('p.maintext').first().text().trim() || 'No Title',
    stats: {
      likes: $('.feather-thumbs-up').closest('div').next().text().trim() || '0',
      comments: $('.feather-message-square').closest('div').next().text().trim() || '0',
      shares: $('.feather-share-2').closest('div').next().text().trim() || '0'
    },
    video: {
      noWatermark: null,
      noWatermarkHd: null
    },
    audio: null
  };

  $('a.download_link').each((_, el) => {
    const $el =$(el);
    const href = $el.attr('href');
    if (!href) return;
    if ($el.hasClass('without_watermark') && !$el.hasClass('without_watermark_hd')) {
      result.video.noWatermark = href;
    }
    if ($el.hasClass('without_watermark_hd')) {
      const direct = $el.attr('data-directurl');
      result.video.noWatermarkHd = direct ? BASE + direct : href;
    }
    if ($el.hasClass('music')) {
      const m = href.match(/\/m\/([A-Za-z0-9_\-=]+)/);
      result.audio = m ? decodeB64Url(m[1]) || href : href;
    }
  });

  return result;
}

export default {
  command: 'tiktok',
  alias: ['tt', 'ttdl', 'tiktokdl', 'ttmp3'],
  category: 'downloader',
  description: 'Mengunduh video atau audio dari TikTok tanpa watermark',
  onlyOwner: false,
  async execute(m, context) {
    const { sock, args } = context;

    // Helper Reaction yang kompatibel
    const react = async (emoji) => {
      try {
        if (sock.message?.react) {
          await sock.message.react(m.chat, m.key, emoji);
        } else if (sock.sendMessage) {
          await sock.sendMessage(m.chat, { react: { text: emoji, key: m.key } });
        }
      } catch (_) {}
    };

    const commandUsed = (m.body || m.text || '').trim().split(' ')[0].replace(/^[./#!]/, '').toLowerCase();

    // Deep Inspector untuk mendeteksi link dari teks pesan atau reply
    const qMessage = m.quoted?.message;
    const quotedText = m.quoted?.text 
      || m.quoted?.caption 
      || qMessage?.extendedTextMessage?.text 
      || qMessage?.conversation 
      || '';

    const textInput = (args && args.length > 0 ? args.join(' ') : '') || quotedText;
    
    // Scan Link TikTok
    const tiktokRegex = /https?:\/\/(www\.|v[tm]\.)?tiktok\.com\/[^\s]+/i;
    const tiktokUrlMatch = textInput.match(tiktokRegex);

    if (!tiktokUrlMatch) {
      await react('❌');
      await sock.message.send(
        m.chat, 
        { text: '⚠️ *Mana Link-nya?*\n\nHarap sertakan link TikTok atau balet/reply pesan yang berisi link TikTok!\n\n*Contoh:* `.tiktok https://vt.tiktok.com/xxxx/`' }, 
        { quoted: m }
      );
      return;
    }

    const targetUrl = tiktokUrlMatch[0];
    const isAudioOnly = commandUsed === 'ttmp3' || (args && (args.includes('mp3') || args.includes('audio')));

    // 1. Reaksi Cooldown saat diproses
    await react('⏳');

    let tempFilePath = null;

    try {
      const data = await scrapeSsstik(targetUrl);
      const downloadUrl = isAudioOnly 
        ? data.audio 
        : (data.video.noWatermarkHd || data.video.noWatermark);

      if (!downloadUrl) {
        throw new Error('Link unduhan media tidak ditemukan dari server SSSTik.');
      }

      const ext = isAudioOnly ? 'mp3' : 'mp4';
      tempFilePath = path.join(process.cwd(), 'tmp', `tiktok_${Date.now()}.${ext}`);

      // Pastikan folder ./tmp/ tersedia
      const tmpDir = path.dirname(tempFilePath);
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }

      // Download file stream ke temporary storage
      const response = await axios({
        method: 'get',
        url: downloadUrl,
        responseType: 'stream',
        headers: {
          'User-Agent': UA,
          'Referer': BASE + '/'
        }
      });

      const writer = fs.createWriteStream(tempFilePath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      const captionText = 
`🎵 *TIKTOK DOWNLOADER*

👤 *Author:* ${data.author}
📌 *Title:* ${data.title}

❤️ *Likes:* ${data.stats.likes}
💬 *Comments:* ${data.stats.comments}
🔁 *Shares:* ${data.stats.shares}`;

      // 2. Kirim Media
      if (isAudioOnly) {
        await sock.message.send(
          m.chat, 
          { 
            type: 'audio', 
            media: tempFilePath,
            mimetype: 'audio/mp4',
            ptt: false
          }, 
          { quoted: m }
        );
      } else {
        await sock.message.send(
          m.chat, 
          { 
            type: 'video', 
            media: tempFilePath, 
            caption: captionText 
          }, 
          { quoted: m }
        );
      }

      // 3. Reaksi Centang jika sukses
      await react('✅');

    } catch (error) {
      // Reaksi Silang jika gagal
      await react('❌');
      await sock.message.send(
        m.chat, 
        { text: `❌ *Gagal Mengunduh TikTok*\n\n*Pesan Error:* ${error.message || 'Terjadi kesalahan sistem.'}` }, 
        { quoted: m }
      );
    } finally {
      // Pembersihan memori Pterodactyl Container
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch (_) {}
      }
    }
  }
};