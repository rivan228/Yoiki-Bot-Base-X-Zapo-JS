// plugins/downloader/mediafire.js
import fs from 'fs';
import path from 'path';

/**
 * Deteksi MIME Type otomatis
 */
function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  const mimes = {
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
    apk: 'application/vnd.android.package-archive',
    pdf: 'application/pdf',
    mp4: 'video/mp4',
    mp3: 'audio/mpeg',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png'
  };
  return mimes[ext] || 'application/octet-stream';
}

/**
 * Scraping link & detail file dari MediaFire
 */
async function getMediaFireDetails(url) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
  };

  const response = await fetch(url.trim(), { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const html = await response.text();

  const dlMatch = html.match(/href=['"](https?:\/\/download[^'"]+)['"]/i) ||
                  html.match(/(https?:\/\/download\d*\.mediafire\.com\/[^\s"'<>]+)/i);

  if (!dlMatch) throw new Error('Link download langsung tidak ditemukan.');
  const downloadUrl = dlMatch[1] || dlMatch[0];

  let filename = '';
  try {
    const rawName = path.basename(new URL(downloadUrl).pathname);
    filename = decodeURIComponent(rawName).replace(/\+/g, ' ');
  } catch {
    filename = 'download.zip';
  }

  const sizeMatch = html.match(/Download\s*\(([\d.]+\s*[KMGT]?B)\)/i);
  const size = sizeMatch ? sizeMatch[1].trim() : 'Unknown';

  return { downloadUrl, filename, size, headers };
}

export default {
  command: 'mediafire',
  alias: ['mf', 'mfdown'],
  category: 'tools',
  description: 'Download file dari MediaFire dengan Zapo-JS Native Engine',
  onlyOwner: false,
  async execute(m, context) {
    const { sock, args } = context;

    if (!args[0]) {
      return await m.reply(`*Contoh:* .mediafire https://www.mediafire.com/file/.../nama.zip/file`);
    }

    let tempFilePath = null;

    try {
      await m.reply('⏳ *Sedang scraping & mengunduh file dari MediaFire...*');

      const { downloadUrl, filename, size, headers } = await getMediaFireDetails(args[0]);
      const mimetype = getMimeType(filename);

      // Pastikan direktori tmp ada
      const tmpDir = path.join(process.cwd(), 'tmp');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

      tempFilePath = path.join(tmpDir, `mf_${Date.now()}_${filename}`);

      // 1. Download file ke penyimpanan lokal container
      const fileRes = await fetch(downloadUrl, { headers });
      if (!fileRes.ok) throw new Error(`CDN Error HTTP ${fileRes.status}`);

      const arrayBuffer = await fileRes.arrayBuffer();
      fs.writeFileSync(tempFilePath, Buffer.from(arrayBuffer));

      // 2. Kirim menggunakan format ASLI Zapo-JS ({ type: 'document', media: ... })
      try {
        await sock.message.send(m.chat, {
          type: 'document',
          media: tempFilePath,
          fileName: filename,
          mimetype: mimetype,
          caption: `✅ *MediaFire Selesai*\n📄 *Nama:* ${filename}\n📊 *Ukuran:* ${size}`
        }, { quoted: m });
      } catch (zapoErr) {
        // Fallback jika messageHandler memiliki adapter Baileys
        const buffer = fs.readFileSync(tempFilePath);
        await sock.message.send(m.chat, {
          document: buffer,
          fileName: filename,
          mimetype: mimetype,
          caption: `✅ *MediaFire Selesai*\n📄 *Nama:* ${filename}\n📊 *Ukuran:* ${size}`
        }, { quoted: m });
      }

    } catch (err) {
      return await m.reply(`❌ *Gagal Mendownload:* ${err.message}`);
    } finally {
      // Hapus file temporary agar disk Pterodactyl tidak penuh
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch {}
      }
    }
  }
};