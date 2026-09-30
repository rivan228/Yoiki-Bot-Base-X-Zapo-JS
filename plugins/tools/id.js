// plugins/tools/id.js

/**
 * Format nomor HP (+62 xxx-xxxx-xxxx)
 */
function formatPhone(numStr) {
  const clean = numStr.replace(/\D/g, '');
  if (clean.startsWith('62')) {
    return `+62 ${clean.slice(2, 5)}-${clean.slice(5, 9)}-${clean.slice(9)}`;
  }
  return `+${clean}`;
}

export default {
  command: 'id',
  alias: ['jid', 'myid', 'getid', 'cekid'],
  category: 'tools',
  description: 'Mengecek ID/JID WhatsApp sendiri atau target reply dengan tombol salin otomatis',
  onlyOwner: false,
  async execute(m, context) {
    const { sock } = context;

    // 1. Deteksi Target: Jika reply ambil target, jika tidak ambil ID sendiri
    let targetJid = null;
    let targetLabel = 'ID Kamu Sendiri';

    if (m.quoted) {
      targetJid = m.quoted.sender || 
                  m.quoted.participant || 
                  m.quoted.key?.participant || 
                  (m.quoted.key?.fromMe ? (sock.user?.id || m.sender) : null);
      targetLabel = 'ID Target (Hasil Reply)';
    } else {
      targetJid = m.sender || m.key?.participant || m.chat;
      targetLabel = 'ID Kamu Sendiri';
    }

    // Bersihkan format device ID (misal: 628xxx:12@s.whatsapp.net -> 628xxx@s.whatsapp.net)
    const cleanJid = (targetJid || '').replace(/:\d+@/, '@');
    const rawNumber = cleanJid.split('@')[0].replace(/\D/g, '');
    const formattedNum = formatPhone(rawNumber);

    // 2. Siapkan Pesan & Tombol Interaktif (Native Flow CTA Copy)
    const bodyText = 
`╭───〔 🆔 *ＷＨＡＴＳＡＰＰ  ＩＤ* 〕───╮
│
│ 👤 *Tipe:* ${targetLabel}
│ 📌 *JID:* \`${cleanJid}\`
│ 📞 *Nomor:* ${formattedNum}
│
╰────────────────────────────╯
_Klik tombol di bawah untuk menyalin langsung ke clipboard._`.trim();

    const interactiveMessage = {
      viewOnceMessage: {
        message: {
          interactiveMessage: {
            body: {
              text: bodyText
            },
            footer: {
              text: "WhatsApp ID Extractor • Zapo-JS"
            },
            nativeFlowMessage: {
              buttons: [
                {
                  name: "cta_copy",
                  buttonParamsJson: JSON.stringify({
                    display_text: "📋 Salin JID",
                    copy_code: cleanJid
                  })
                },
                {
                  name: "cta_copy",
                  buttonParamsJson: JSON.stringify({
                    display_text: "📱 Salin Nomor",
                    copy_code: rawNumber
                  })
                }
              ]
            }
          }
        }
      }
    };

    // 3. Kirim via Native Flow Buttons dengan Fallback Otomatis
    try {
      if (typeof sock.relayMessage === 'function') {
        return await sock.relayMessage(m.chat, interactiveMessage, { messageId: m.key.id });
      } else {
        return await sock.message.send(m.chat, interactiveMessage, { quoted: m });
      }
    } catch {
      // Fallback jika WhatsApp room menolak interactive buttons
      return await m.reply(
        `${bodyText}\n\n` +
        `💡 _Teks abu-abu pada JID & Nomor di atas dapat langsung disentuh untuk disalin._`
      );
    }
  }
};