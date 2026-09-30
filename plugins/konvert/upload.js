// plugins/tools/tourl.js
import path from 'path';

/**
 * Deep Inspector: Mendeteksi media di pesan langsung maupun reply
 */
function findMedia(m) {
  const quotedRaw = m.quoted?.message || m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const directRaw = m.message;

  const candidates = [
    m.quoted,
    m.quoted?.msg,
    quotedRaw?.imageMessage,
    quotedRaw?.videoMessage,
    quotedRaw?.audioMessage,
    quotedRaw?.documentMessage,
    quotedRaw?.stickerMessage,
    quotedRaw?.viewOnceMessage?.message?.imageMessage,
    quotedRaw?.viewOnceMessage?.message?.videoMessage,
    quotedRaw?.viewOnceMessageV2?.message?.imageMessage,
    quotedRaw?.viewOnceMessageV2?.message?.videoMessage,
    m,
    m.msg,
    directRaw?.imageMessage,
    directRaw?.videoMessage,
    directRaw?.audioMessage,
    directRaw?.documentMessage,
    directRaw?.stickerMessage
  ].filter(Boolean);

  for (const item of candidates) {
    const mime = item.mimetype || item.mime || '';
    const mtype = item.mtype || item.type || '';

    if (mime || /Message/i.test(mtype)) {
      return {
        target: item,
        mimetype: mime || 'application/octet-stream',
        filename: item.fileName || item.filename || null
      };
    }
  }

  return null;
}

/**
 * Unduh buffer media dari pesan Zapo-JS
 */
async function extractMediaBuffer(mediaInfo, m, sock) {
  if (m.quoted && typeof m.quoted.download === 'function') {
    try {
      const b = await m.quoted.download();
      if (b && b.length > 0) return b;
    } catch {}
  }

  if (typeof m.download === 'function') {
    try {
      const b = await m.download();
      if (b && b.length > 0) return b;
    } catch {}
  }

  if (sock?.message?.download) {
    try {
      const b = await sock.message.download(m.quoted || m);
      if (b && b.length > 0) return b;
    } catch {}
  }

  if (typeof mediaInfo.target.download === 'function') {
    try {
      const b = await mediaInfo.target.download();
      if (b && b.length > 0) return b;
    } catch {}
  }

  try {
    const zapo = await import('zapo-js');
    const dlFunc = zapo.downloadContentFromMessage || zapo.downloadMediaMessage;
    if (typeof dlFunc === 'function') {
      const mediaType = mediaInfo.mimetype.split('/')[0] || 'document';
      const stream = await zapo.downloadContentFromMessage(mediaInfo.target, mediaType);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      if (buf.length > 0) return buf;
    }
  } catch {}

  throw new Error('Gagal mengunduh media dari WhatsApp.');
}

/**
 * Upload ke cloud.yardansh.com menggunakan FormData native
 */
async function uploadToYardan(buffer, filename, mimetype) {
  const blob = new Blob([buffer], { type: mimetype });
  const formData = new FormData();
  formData.append('file', blob, filename);

  const res = await fetch('https://cloud.yardansh.com/upload', {
    method: 'POST',
    body: formData,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Server menolak upload (HTTP ${res.status}): ${errText || res.statusText}`);
  }

  const json = await res.json();
  return json;
}

export default {
  command: 'tourl',
  alias: ['up', 'upload', 'uploader'],
  category: 'tools',
  description: 'Upload media apa saja ke cloud.yardansh.com dan dapatkan link langsung',
  onlyOwner: false,
  async execute(m, context) {
    const { sock } = context;

    // 1. Deteksi Media yang Di-reply
    const media = findMedia(m);

    if (!media) {
      return await m.reply(
        `*CARA PENGGUNAAN TOURL / UPLOAD*\n\n` +
        `Kirim atau reply Foto, Video, Audio, Stiker, atau Dokumen dengan caption:\n` +
        `└ \`.tourl\` atau \`.up\``
      );
    }

    try {
      await m.reply('⏳ *Sedang mengunduh & mengunggah file ke cloud...*');

      // 2. Ambil Buffer File
      const buffer = await extractMediaBuffer(media, m, sock);

      // 3. Tentukan Nama & Ekstensi File
      let ext = media.mimetype.split('/')[1]?.split(';')[0] || 'bin';
      if (ext === 'jpeg') ext = 'jpg';
      if (ext === 'vnd.android.package-archive') ext = 'apk';
      if (ext === 'x-rar-compressed') ext = 'rar';

      const finalFilename = media.filename || `file_${Date.now()}.${ext}`;

      // 4. Proses Upload ke Cloud
      const result = await uploadToYardan(buffer, finalFilename, media.mimetype);

      // 5. Susun Pesan Hasil
      const formattedSize = result.size || `${(buffer.length / (1024 * 1024)).toFixed(2)} MB`;
      const expireText = result.expiresAt ? new Date(result.expiresAt).toLocaleString('id-ID') : 'Tidak ditentukan';

      const responseText = 
`🚀 *FILE BERHASIL DIUNGGAH!*
──────────────────────
🔗 *URL File:*
${result.url}

📄 *Nama File:* \`${finalFilename}\`
📊 *Ukuran:* ${formattedSize}
⚙️ *Tipe:* \`${media.mimetype}\`
⏱️ *Kadaluarsa:* ${expireText}
──────────────────────
_Powered by cloud.yardansh.com_`.trim();

      return await m.reply(responseText);

    } catch (err) {
      if (err.message.includes('fetch failed') || err.message.includes('ENOTFOUND')) {
        return await m.reply('❌ *Gagal Terhubung:* Server Pterodactyl Anda memblokir koneksi outgoing ke host uploader.');
      }
      return await m.reply(`❌ *Upload Gagal:* ${err.message}`);
    }
  }
};