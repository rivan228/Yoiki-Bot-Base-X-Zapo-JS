// plugins/tools/cat.js

const MIME_MAP = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg', 'ico', 'heic', 'heif'],
  video: ['mp4', 'mkv', 'mov', 'avi', 'webm', '3gp', 'flv', 'wmv', 'm4v', 'mpeg', 'mpg'],
  audio: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus', 'wma', 'amr'],
  text: [
    'txt', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'json', 'html', 'htm', 'css', 'scss', 'less',
    'xml', 'csv', 'tsv', 'md', 'markdown', 'log', 'yml', 'yaml', 'ini', 'env', 'sql',
    'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'bash', 'bat', 'ps1',
    'vue', 'svelte', 'conf', 'toml', 'properties', 'gradle'
  ]
};

function getMediaType(fileName = '', mimetype = '') {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  if (MIME_MAP.image.includes(ext) || mimetype.startsWith('image/')) return 'image';
  if (MIME_MAP.video.includes(ext) || mimetype.startsWith('video/')) return 'video';
  if (MIME_MAP.audio.includes(ext) || mimetype.startsWith('audio/')) return 'audio';
  if (
    MIME_MAP.text.includes(ext) ||
    mimetype.startsWith('text/') ||
    ['application/json', 'application/javascript', 'application/xml', 'application/x-yaml'].includes(mimetype)
  ) {
    return 'text';
  }

  return 'document';
}

/**
 * Deep Inspector: Mendeteksi dokumen di pesan reply maupun pesan langsung
 */
function findDocument(m) {
  const quotedRaw = m.quoted?.message || m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const directRaw = m.message;

  const candidates = [
    quotedRaw?.documentMessage,
    quotedRaw?.documentWithCaptionMessage?.message?.documentMessage,
    m.quoted?.msg,
    m.quoted,
    directRaw?.documentMessage,
    directRaw?.documentWithCaptionMessage?.message?.documentMessage,
    m.msg,
    m
  ].filter(Boolean);

  for (const item of candidates) {
    const isDoc = item.fileName || item.filename || /document/i.test(item.mtype || item.type || '');
    if (isDoc) {
      return {
        target: item,
        fileName: item.fileName || item.filename || 'file.bin',
        mimetype: item.mimetype || 'application/octet-stream'
      };
    }
  }

  return null;
}

/**
 * Unduh buffer media secara aman
 */
async function extractBuffer(targetItem, m, sock) {
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

  if (typeof targetItem.target.download === 'function') {
    try {
      const b = await targetItem.target.download();
      if (b && b.length > 0) return b;
    } catch {}
  }

  try {
    const zapo = await import('zapo-js');
    const dlFunc = zapo.downloadContentFromMessage || zapo.downloadMediaMessage;
    if (typeof dlFunc === 'function') {
      const stream = await zapo.downloadContentFromMessage(targetItem.target, 'document');
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const b = Buffer.concat(chunks);
      if (b.length > 0) return b;
    }
  } catch {}

  throw new Error('Gagal mengunduh file dokumen.');
}

export default {
  command: 'cat',
  alias: ['buka', 'readdoc', 'viewdoc'],
  category: 'tools',
  description: 'Membuka isi dokumen teks/kodingan atau mengubah dokumen foto/video jadi media biasa',
  onlyOwner: false,
  async execute(m, context) {
    const { sock } = context;

    // 1. Deteksi Dokumen
    const docData = findDocument(m);

    if (!docData) {
      return await m.reply(
        `*CARA MENGGUNAKAN FITUR BUKA DOKUMEN*\n\n` +
        `Reply file dokumen apapun dengan caption:\n` +
        `└ \`.cat\` atau \`.buka\`\n\n` +
        `• *File Teks/Kodingan (.js, .txt, .json):* Isinya langsung ditampilkan di chat.\n` +
        `• *File Foto/Video/Audio:* Diubah menjadi media yang langsung bisa dilihat/didengar.`
      );
    }

    try {
      await m.reply('⏳ *Sedang membaca dan mengekstrak dokumen...*');

      // 2. Ambil Buffer Dokumen
      const buffer = await extractBuffer(docData, m, sock);
      const { fileName, mimetype } = docData;
      const mediaType = getMediaType(fileName, mimetype);

      // KASUS 1: FILE TEKS / SCRIPT KODINGAN
      if (mediaType === 'text') {
        let content = buffer.toString('utf-8');

        // Proteksi limit teks agar WhatsApp tidak crash jika filenya sangat besar
        const MAX_LEN = 3500;
        let isTruncated = false;
        if (content.length > MAX_LEN) {
          content = content.slice(0, MAX_LEN);
          isTruncated = true;
        }

        let output = `📄 *ISI DOKUMEN:* \`${fileName}\`\n`;
        output += `──────────────────────\n`;
        output += `\`\`\`${content}\`\`\`\n`;
        output += `──────────────────────\n`;
        if (isTruncated) {
          output += `⚠️ _Teks dipotong karena melebihi 3.500 karakter._`;
        }

        return await m.reply(output);
      }

      // KASUS 2: FOTO (CONVERT DOKUMEN -> GAMBAR BIASA)
      if (mediaType === 'image') {
        return await sock.message.send(m.chat, {
          type: 'image',
          media: buffer,
          caption: `📸 *Dokumen Gambar Dibuka:* \`${fileName}\``
        }, { quoted: m });
      }

      // KASUS 3: VIDEO (CONVERT DOKUMEN -> VIDEO BIASA)
      if (mediaType === 'video') {
        return await sock.message.send(m.chat, {
          type: 'video',
          media: buffer,
          caption: `🎥 *Dokumen Video Dibuka:* \`${fileName}\``
        }, { quoted: m });
      }

      // KASUS 4: AUDIO / SUARA
      if (mediaType === 'audio') {
        return await sock.message.send(m.chat, {
          type: 'audio',
          media: buffer,
          mimetype: mimetype || 'audio/mp4'
        }, { quoted: m });
      }

      // KASUS 5: DOKUMEN LAIN (ZIP, APK, PDF, DLL) -> KIRIM ULANG
      return await sock.message.send(m.chat, {
        type: 'document',
        media: buffer,
        fileName: fileName,
        mimetype: mimetype,
        caption: `📦 *File Dokumen:* \`${fileName}\``
      }, { quoted: m });

    } catch (err) {
      return await m.reply(`❌ *Gagal membuka dokumen:* ${err.message}`);
    }
  }
};