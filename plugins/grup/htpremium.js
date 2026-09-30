// plugins/grup/htpremium.js
import fs from 'fs';
import path from 'path';

// Helper: Ekstraksi angka nomor telepon murni
function getCleanNumber(raw) {
  if (Array.isArray(raw)) return getCleanNumber(raw[0]);
  if (typeof raw === 'object' && raw !== null) {
    return getCleanNumber(raw.id || raw.jid || raw.number || Object.values(raw)[0]);
  }
  return String(raw || '')
    .split('@')[0]
    .split(':')[0]
    .replace(/[^0-9]/g, '');
}

// Helper: Deep Inspector untuk membongkar pesan media berlapis
function inspectQuotedMedia(m) {
  if (!m.quoted) return null;
  const qMsg = m.quoted.message || m.quoted;

  const image = qMsg.imageMessage ||
    qMsg.viewOnceMessage?.message?.imageMessage ||
    qMsg.viewOnceMessageV2?.message?.imageMessage ||
    qMsg.ephemeralMessage?.message?.imageMessage;
  if (image) return { type: 'image', msg: image, mimetype: image.mimetype || 'image/jpeg', caption: image.caption || '' };

  const video = qMsg.videoMessage ||
    qMsg.viewOnceMessage?.message?.videoMessage ||
    qMsg.viewOnceMessageV2?.message?.videoMessage ||
    qMsg.ephemeralMessage?.message?.videoMessage;
  if (video) return { type: 'video', msg: video, mimetype: video.mimetype || 'video/mp4', caption: video.caption || '' };

  const audio = qMsg.audioMessage ||
    qMsg.viewOnceMessage?.message?.audioMessage ||
    qMsg.ephemeralMessage?.message?.audioMessage;
  if (audio) return { type: 'audio', msg: audio, mimetype: audio.mimetype || 'audio/mp4', ptt: audio.ptt || false };

  const sticker = qMsg.stickerMessage || qMsg.ephemeralMessage?.message?.stickerMessage;
  if (sticker) return { type: 'sticker', msg: sticker, mimetype: sticker.mimetype || 'image/webp' };

  const document = qMsg.documentMessage || qMsg.ephemeralMessage?.message?.documentMessage;
  if (document) {
    return {
      type: 'document',
      msg: document,
      mimetype: document.mimetype || 'application/octet-stream',
      fileName: document.fileName || 'file'
    };
  }

  return null;
}

// Helper: Resolver metadata grup yang adaptif untuk zapo-js
async function resolveGroupMetadata(sock, m, context) {
  if (context?.groupMetadata?.participants?.length) return context.groupMetadata;
  if (m?.groupMetadata?.participants?.length) return m.groupMetadata;

  if (typeof sock?.group?.queryGroupMetadata === 'function') {
    return await sock.group.queryGroupMetadata(m.chat);
  }
  if (typeof sock?.group?.getGroupMetadata === 'function') {
    return await sock.group.getGroupMetadata(m.chat);
  }
  if (typeof sock?.group?.fetchGroupMetadata === 'function') {
    return await sock.group.fetchGroupMetadata(m.chat);
  }
  if (typeof sock?.group?.get === 'function') {
    return await sock.group.get(m.chat);
  }
  if (typeof sock?.groupMetadata === 'function') {
    return await sock.groupMetadata(m.chat);
  }

  return null;
}

// Helper: Verifikasi status Owner
function checkIsOwner(m, sock, senderJid) {
  if (m.key?.fromMe) return true;

  const senderDigits = getCleanNumber(senderJid);
  const botDigits = getCleanNumber(sock?.user?.id);
  if (senderDigits && botDigits && senderDigits === botDigits) return true;

  const rawOwners = [
    ...(Array.isArray(global.owner) ? global.owner : [global.owner]),
    global.nomorowner,
    global.nobot,
    global.ownerNumber
  ].filter(Boolean);

  for (const item of rawOwners) {
    const ownerDigits = getCleanNumber(item);
    if (ownerDigits && senderDigits === ownerDigits) return true;
  }

  return false;
}

// Helper: Verifikasi status Admin Grup (Support LID & Device ID)
function checkIsAdmin(participants, senderJid, m) {
  const senderDigits = getCleanNumber(senderJid);
  const rawSender = String(senderJid || '').split(':')[0].replace(/[^0-9]/g, '');

  return participants.some((p) => {
    const isAdminRole = p.admin === 'admin' || p.admin === 'superadmin';
    if (!isAdminRole) return false;

    const pDigits = getCleanNumber(p.id || p.jid);
    if (pDigits && senderDigits && pDigits === senderDigits) return true;

    if (p.id && (p.id === senderJid || p.id.includes(rawSender))) return true;
    if (p.jid && (p.jid === senderJid || p.jid.includes(rawSender))) return true;
    if (p.lid && (p.lid === senderJid || (m.key?.participant && p.lid === m.key.participant))) return true;

    return false;
  });
}

export default {
  command: 'htpremium',
  alias: ['hidetagpremium', 'htprem', 'htagprem'],
  category: 'grup',
  description: 'Hidetag premium dengan custom tag groupMentions dan support media lengkap',
  onlyOwner: false,
  async execute(m, context) {
    const { sock, args } = context;

    // 1. Validasi khusus grup
    if (!m.isGroup) {
      return await m.reply('❌ Perintah ini hanya dapat digunakan di dalam grup!');
    }

    let tempMediaFilePath = null;

    try {
      // 2. Ambil metadata grup & daftar seluruh member
      const groupMetadata = await resolveGroupMetadata(sock, m, context);
      const participants = groupMetadata?.participants || [];
      const mentions = participants.map((p) => p.id || p.jid).filter(Boolean);

      if (!mentions.length) {
        return await m.reply('❌ Gagal mendeteksi anggota grup dari metadata.');
      }

      // 3. Validasi hak akses (Hanya Admin Grup atau Owner Bot)
      const senderJid = m.sender || m.key?.participant || '';
      const isOwner = checkIsOwner(m, sock, senderJid) || context?.isOwner || m?.isOwner;
      const isAdmin = checkIsAdmin(participants, senderJid, m) || context?.isAdmin || m?.isAdmin;

      if (!isAdmin && !isOwner) {
        return await m.reply('❌ Perintah ini khusus untuk *Admin Grup* atau *Owner Bot*.');
      }

      // 4. Parsing pesan teks dan custom tag
      const rawInput = args.join(' ').trim();
      let customTag = 'everyone';
      let messageText = '';

      if (rawInput.includes('|')) {
        const [tagPart, ...msgParts] = rawInput.split('|');
        customTag = tagPart.trim() || 'everyone';
        messageText = msgParts.join('|').trim();
      } else {
        messageText = rawInput;
      }

      const mediaInfo = inspectQuotedMedia(m);
      const quoted = m.quoted;

      // 5. Kasus A: Reply Pesan Media / Teks
      if (quoted) {
        if (mediaInfo) {
          let buffer = null;

          if (typeof m.quoted?.download === 'function') {
            buffer = await m.quoted.download();
          } else if (typeof m.download === 'function') {
            buffer = await m.download();
          } else if (typeof sock.downloadMediaMessage === 'function') {
            buffer = await sock.downloadMediaMessage(m.quoted || m);
          } else if (typeof sock?.message?.download === 'function') {
            buffer = await sock.message.download(m.quoted || m);
          }

          if (!buffer || !Buffer.isBuffer(buffer)) {
            return await m.reply('❌ Gagal mengunduh media dari pesan yang di-reply.');
          }

          const tmpDir = path.resolve('./tmp');
          if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

          const ext = mediaInfo.mimetype.split('/')[1]?.split(';')[0] || 'bin';
          tempMediaFilePath = path.join(tmpDir, `htprem_${Date.now()}.${ext}`);
          fs.writeFileSync(tempMediaFilePath, buffer);

          const finalCaption = messageText || mediaInfo.caption || '';

          // Format kirim media resmi Zapo-JS
          const sendPayload = {
            type: mediaInfo.type,
            media: tempMediaFilePath,
            mimetype: mediaInfo.mimetype,
            mentions: mentions
          };

          if (mediaInfo.type === 'image' || mediaInfo.type === 'video') {
            sendPayload.caption = finalCaption;
          }

          if (mediaInfo.type === 'audio') {
            sendPayload.ptt = mediaInfo.ptt || false;
          }

          if (mediaInfo.type === 'document') {
            sendPayload.fileName = mediaInfo.fileName || 'file';
            if (finalCaption) sendPayload.caption = finalCaption;
          }

          await sock.message.send(m.chat, sendPayload);

          // Jika media adalah stiker atau audio dan ada teks tambahan yang disertakan
          if ((mediaInfo.type === 'sticker' || mediaInfo.type === 'audio') && finalCaption) {
            await sock.message.send(m.chat, {
              text: finalCaption,
              mentions: mentions
            });
          }

          return;
        }

        // Jika mereply pesan teks biasa
        const qMsg = quoted.message || {};
        const quotedText =
          quoted.text ||
          qMsg.conversation ||
          qMsg.extendedTextMessage?.text ||
          '';

        const finalText = messageText || quotedText;

        if (!finalText) {
          return await m.reply('❌ Pesan yang di-reply tidak memiliki teks.');
        }

        return await sock.message.send(m.chat, {
          text: finalText,
          mentions: mentions
        });
      }

      // 6. Kasus B: Tidak me-reply pesan (Menggunakan Custom Group Mentions)
      if (!messageText) {
        return await m.reply(
          `📢 *HIDETAG PREMIUM*\n\n` +
          `• *Format Teks:* \`.htprem <custom tag> | <pesan>\`\n` +
          `  _Contoh: .htprem everyone | Halo semua, jangan lupa rapat jam 8 malam!_\n\n` +
          `• *Format Singkat:* \`.htprem <pesan>\`\n` +
          `  _Contoh: .htprem Halo semua_\n\n` +
          `• *Reply Media:* Reply foto/video/stiker/audio/dokumen lalu ketik \`.htprem\``
        );
      }

      // Kirim teks dengan WhatsApp groupMentions payload resmi
      await sock.message.send(m.chat, {
        text: `@${m.chat} ${messageText}`,
        mentions: mentions,
        contextInfo: {
          groupMentions: [
            {
              groupJid: m.chat,
              groupSubject: customTag
            }
          ],
          mentionedJid: mentions
        }
      }, { quoted: m });

    } catch (err) {
      console.error('[HTPremium Plugin Error]:', err);
      await m.reply(`❌ *Terjadi kesalahan saat mengeksekusi Hidetag Premium:*\n> ${err.message || err}`);
    } finally {
      // 7. Pembersihan storage ./tmp/ di container Pterodactyl
      if (tempMediaFilePath && fs.existsSync(tempMediaFilePath)) {
        try {
          fs.unlinkSync(tempMediaFilePath);
        } catch (_) {}
      }
    }
  }
};