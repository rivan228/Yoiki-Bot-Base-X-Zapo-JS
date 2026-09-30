// plugins/chanel/rch.js

// Fungsi utama eksekusi
const execute = async (m, context) => {
  // Kompatibilitas multi-context: support { sock, args } maupun (m, { sock })
  const sock = context?.sock || context?.Cantarella || global.sock;
  const args = context?.args || (m.text ? m.text.trim().split(/\s+/).slice(1) : []);

  // Helper kirim pesan anti-gagal (fallback otomatis)
  const sendReply = async (text) => {
    try {
      if (typeof m.reply === 'function') return await m.reply(text);
      return await sock.message.send(m.chat, { text }, { quoted: m });
    } catch (_) {
      try {
        return await sock.message.send(m.chat, { text });
      } catch (e) {
        console.error('[RCH] Gagal kirim pesan balasan:', e.message);
      }
    }
  };

  // 1. Ambil API Key langsung tanpa import lambat
  const apiKey =
    global.jagoanKey ||
    global.config?.jagoanKey ||
    context?.config?.jagoanKey ||
    'gustodx'; // fallback otomatis ke apikey bawaan

  const input = args.join(' ').trim();

  // 2. Validasi input jika user hanya mengetik .rch
  if (!input) {
    return await sendReply(
      `⚡ *REACT CHANNEL WHATSAPP*\n\n` +
      `*Format Penggunaan:*\n` +
      `> \`.rch <link_post_channel> <emoji>\`\n\n` +
      `*Contoh:*\n` +
      `• \`.rch https://whatsapp.com/channel/0029VanhMDo42DcjiRGJOc2m/454 🥳,😍,🥰\`\n` +
      `• \`.rch https://whatsapp.com/channel/0029VanhMDo42DcjiRGJOc2m/454 👍\`\n\n` +
      `_Catatan: Link wajib menyertakan nomor post di akhir (contoh: /454)._`
    );
  }

  let postLink = '';
  let emoji = '';

  // 3. Parsing input URL & Emoji
  if (input.includes('|')) {
    const [linkPart, ...emojiParts] = input.split('|');
    postLink = linkPart.trim();
    emoji = emojiParts.join('|').trim();
  } else {
    const parts = input.split(/\s+/);
    const urlIndex = parts.findIndex((p) => /whatsapp\.com\/channel\/[a-zA-Z0-9_-]+\/\d+/i.test(p));

    if (urlIndex !== -1) {
      postLink = parts[urlIndex];
      parts.splice(urlIndex, 1);
      emoji = parts.join(' ').trim();
    } else {
      postLink = parts[0] || '';
      emoji = parts.slice(1).join(' ').trim();
    }
  }

  // 4. Validasi Link Saluran
  if (!/whatsapp\.com\/channel\/[a-zA-Z0-9_-]+\/\d+/i.test(postLink)) {
    return await sendReply(
      '❌ *Link Postingan Saluran tidak valid!*\n\n' +
      'Link harus mengarah ke post tertentu yang ada nomornya di akhir URL.\n' +
      'Contoh:\n' +
      '> `https://whatsapp.com/channel/0029VanhMDo42DcjiRGJOc2m/454`'
    );
  }

  // 5. Normalisasi Emoji
  if (!emoji) {
    emoji = '🥳,😍,🥰';
  } else {
    emoji = emoji
      .split(/[\s,]+/)
      .filter(Boolean)
      .slice(0, 20)
      .join(',');
  }

  // Berikan respon awal agar user tahu bot sedang bekerja
  await sendReply('⏳ *Sedang memproses reaksi ke postingan saluran...*');

  try {
    // 6. Request ke API Jagoan Project sesuai spesifikasi cURL
    const endpoint = `https://api.jagoanproject.com/api/tools/reactchannel?post_link=${encodeURIComponent(postLink)}&emoji=${encodeURIComponent(emoji)}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });

    const res = await response.json();

    // 7. Cek status respon
    if (!res || res.status !== true) {
      const errorMsg = res?.result?.message || res?.message || 'Server gagal memproses reaksi.';
      return await sendReply(`❌ *Gagal memberikan reaksi:*\n> ${errorMsg}`);
    }

    const successfulServers = res.result?.successful_servers?.join(', ') || '-';
    const failedServers = res.result?.failed_servers?.length ? res.result.failed_servers.join(', ') : 'Tidak ada';
    const sisaLimit = res.sisa_limit != null ? Number(res.sisa_limit).toLocaleString('id-ID') : '-';
    const limitCost = res.limit_cost ?? 100;

    const reportText =
      `⚡ *REACT CHANNEL BERHASIL*\n\n` +
      `╭┈┈⬡「 📢 *TARGET POST* 」\n` +
      `┃ • *Post Link:* ${postLink}\n` +
      `┃ • *Emoji:* ${emoji.split(',').join(' ')}\n` +
      `╰┈┈┈┈┈┈┈┈⬡\n\n` +
      `╭┈┈⬡「 🖥️ *STATUS SERVER* 」\n` +
      `┃ • *Server Sukses:* ${successfulServers}\n` +
      `┃ • *Server Gagal:* ${failedServers}\n` +
      `┃ • *Limit Terpakai:* ${limitCost}\n` +
      `┃ • *Sisa Limit API:* ${sisaLimit}\n` +
      `╰┈┈┈┈┈┈┈┈⬡\n\n` +
      `> _${res.result?.message || 'Reaksi berhasil diproses.'}_`;

    await sendReply(reportText);

  } catch (err) {
    console.error('[React Channel Error]:', err);
    await sendReply(`❌ *Terjadi kendala koneksi ke server:*\n> ${err.message || 'Timeout'}`);
  }
};

// -------------------------------------------------------------
// UNIVERSAL EXPORT: Menjamin plugin terbaca oleh loader tipe apa pun
// -------------------------------------------------------------
export const config = {
  name: ['rch', 'reactchannel', 'reactch', 'rchannel'],
  command: 'rch',
  alias: ['reactchannel', 'reactch', 'rchannel'],
  category: 'chanel',
  description: 'Memberikan reaksi emoji otomatis pada postingan Saluran/Channel WhatsApp',
  onlyOwner: false
};

export const handler = execute;
export const run = execute;

export default {
  command: 'rch',
  name: ['rch', 'reactchannel', 'reactch', 'rchannel'],
  alias: ['reactchannel', 'reactch', 'rchannel'],
  category: 'chanel',
  description: 'Memberikan reaksi emoji otomatis pada postingan Saluran/Channel WhatsApp',
  onlyOwner: false,
  execute,
  run: execute,
  handler: execute
};