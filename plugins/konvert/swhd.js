// plugins/konvert/swhd.js
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Deep Inspector: Membongkar seluruh lapisan pesan untuk menemukan Foto / Video
 */
function findMedia(m) {
  const quotedRaw = m.quoted?.message || m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const directRaw = m.message;

  const candidates = [
    m.quoted,
    m.quoted?.msg,
    quotedRaw?.imageMessage,
    quotedRaw?.videoMessage,
    quotedRaw?.viewOnceMessage?.message?.imageMessage,
    quotedRaw?.viewOnceMessage?.message?.videoMessage,
    quotedRaw?.viewOnceMessageV2?.message?.imageMessage,
    quotedRaw?.viewOnceMessageV2?.message?.videoMessage,
    quotedRaw?.documentWithCaptionMessage?.message?.videoMessage,
    quotedRaw?.documentWithCaptionMessage?.message?.imageMessage,
    m,
    m.msg,
    directRaw?.imageMessage,
    directRaw?.videoMessage,
    directRaw?.viewOnceMessage?.message?.imageMessage,
    directRaw?.viewOnceMessage?.message?.videoMessage
  ].filter(Boolean);

  for (const item of candidates) {
    const mime = item.mimetype || item.mime || '';
    const mtype = item.mtype || item.type || '';

    if (/image\/(jpe?g|png|webp)/i.test(mime) || /imageMessage/i.test(mtype)) {
      return { isImage: true, isVideo: false, target: item };
    }

    if (/video\/(mp4|3gpp|quicktime)/i.test(mime) || /videoMessage/i.test(mtype)) {
      return { isImage: false, isVideo: true, target: item };
    }
  }

  return null;
}

/**
 * Ekstraktor Buffer Media Anti-Gagal
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
      const stream = await zapo.downloadContentFromMessage(
        mediaInfo.target,
        mediaInfo.isVideo ? 'video' : 'image'
      );
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      if (buf.length > 0) return buf;
    }
  } catch {}

  throw new Error('Gagal mengambil file media.');
}

export default {
  command: 'swhd',
  alias: ['hdsw', 'statushd', 'hdstatus', 'sw4k'],
  category: 'konvert',
  description: 'Konversi Foto/Video ke 4K Ultra HD & 60 FPS untuk Status WhatsApp',
  onlyOwner: false,
  async execute(m, context) {
    const { sock } = context;

    const media = findMedia(m);

    if (!media) {
      return await m.reply(
        `*CARA PENGGUNAAN SWHD 4K 60FPS*\n\n` +
        `Reply Foto atau Video dengan caption:\n` +
        `└ \`.swhd\`\n\n` +
        `_Otomatis di-Upscale ke 4K UHD + 60 FPS (Video) + Anti-Kompresi Status sekaligus._`
      );
    }

    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const id = Date.now();
    let inPath = null;
    let outPath = null;

    try {
      await m.reply(`⚡ *Sedang memproses ${media.isVideo ? 'Video ke 4K 60 FPS' : 'Foto ke 4K Ultra HD'}... Mohon tunggu sebentar.*`);

      const buf = await extractMediaBuffer(media, m, sock);

      // ==========================================
      // FOTO: TRUE 4K (3840p) + LANCZOS + ULTRA Q:1
      // ==========================================
      if (media.isImage) {
        inPath = path.join(tmpDir, `in_${id}.jpg`);
        outPath = path.join(tmpDir, `swhd_${id}.jpg`);
        fs.writeFileSync(inPath, buf);

        // Skala 4K (kotak 3840x3840 presisi aspect ratio) + Unsharp mikro tajam + Penajaman warna
        const photoFilter = `"scale=3840:3840:force_original_aspect_ratio=decrease:flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2,unsharp=7:7:1.5:7:7:0.5,eq=contrast=1.04:saturation=1.06"`;
        const cmd = `ffmpeg -y -i "${inPath}" -vf ${photoFilter} -q:v 1 "${outPath}"`;
        await execAsync(cmd);

        const caption = 
`✨ *FOTO STATUS 4K ULTRA HD SIAP!*
──────────────────────
📐 *Resolusi:* 4K UHD (3840p Lanczos)
💎 *Kualitas:* Visually Lossless (Q:1)
🎨 *Color:* Enhanced Dynamic Contrast
💡 *Cara Pasang ke SW:*
Tinggal klik ikon **Panah Teruskan (⤹)** ➔ Pilih **"Status Saya"**.
──────────────────────`;

        try {
          await sock.message.send(m.chat, {
            type: 'image',
            media: outPath,
            caption
          }, { quoted: m });
        } catch {
          const imgBuf = fs.readFileSync(outPath);
          await sock.message.send(m.chat, { image: imgBuf, caption }, { quoted: m });
        }

      // ==========================================
      // VIDEO: TRUE 4K (2160p/3840p) + 60 FPS + CRF 15
      // ==========================================
      } else if (media.isVideo) {
        inPath = path.join(tmpDir, `in_${id}.mp4`);
        outPath = path.join(tmpDir, `swhd_${id}.mp4`);
        fs.writeFileSync(inPath, buf);

        // Skala 4K UHD, Frame rate 60 FPS, CRF 15 (Mastering Quality), Audio Studio 256kbps 48kHz
        const videoFilter = `"scale=3840:3840:force_original_aspect_ratio=decrease:flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2,unsharp=5:5:1.0:5:5:0.3,eq=contrast=1.03:saturation=1.05"`;
        const cmd = `ffmpeg -y -i "${inPath}" -c:v libx264 -preset veryfast -crf 15 -r 60 -pix_fmt yuv420p -vf ${videoFilter} -c:a aac -b:a 256k -ar 48000 -movflags +faststart "${outPath}"`;
        await execAsync(cmd);

        const caption = 
`✨ *VIDEO STATUS 4K 60 FPS SIAP!*
──────────────────────
📐 *Resolusi:* 4K UHD (2160p/3840p)
⚡ *Frame Rate:* 60 FPS (Ultra Smooth)
💎 *Encoding:* H.264 Master (CRF 15)
🔊 *Audio:* 256kbps Hi-Fi Stereo
💡 *Cara Pasang ke SW:*
Tinggal klik ikon **Panah Teruskan (⤹)** ➔ Pilih **"Status Saya"**.
──────────────────────`;

        try {
          await sock.message.send(m.chat, {
            type: 'video',
            media: outPath,
            caption
          }, { quoted: m });
        } catch {
          const vidBuf = fs.readFileSync(outPath);
          await sock.message.send(m.chat, { video: vidBuf, caption }, { quoted: m });
        }
      }

    } catch (err) {
      return await m.reply(`❌ *Gagal memproses SWHD 4K:* ${err.message}`);
    } finally {
      if (inPath && fs.existsSync(inPath)) {
        try { fs.unlinkSync(inPath); } catch {}
      }
      if (outPath && fs.existsSync(outPath)) {
        try { fs.unlinkSync(outPath); } catch {}
      }
    }
  }
};