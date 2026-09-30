// plugins/grup/addai.js

export default {
  command: 'addai',
  alias: ['addmetaai', 'joinai'],
  category: 'grup',
  description: 'Menambahkan bot Meta AI ke dalam grup WhatsApp',
  onlyOwner: false,

  async execute(m, context) {
    const { sock, conn } = context
    const client = sock || conn || context.client
    const groupJid = m.jid

    // 1. Validasi apakah dikirim di dalam grup
    if (!groupJid.endsWith('@g.us')) {
      return await m.reply('❌ Command ini hanya bisa digunakan di dalam grup.')
    }

    if (typeof m.react === 'function') await m.react('⏳')

    // Fake Quoted Meta Verified resmi sistem
    const fkontak = {
      key: {
        participant: '0@s.whatsapp.net',
        remoteJid: 'status@broadcast',
        fromMe: false,
        id: 'META_VERIFIED'
      },
      message: {
        contactMessage: {
          displayName: 'gustodx',
          vcard: 'BEGIN:VCARD\nVERSION:3.0\nN:;gustodx;;;\nFN:gustodx\nORG:WhatsApp Business • Status\nTITLE:⤹ Diteruskan\nTEL;type=CELL;type=VOICE;waid=0:+0\nEND:VCARD'
        }
      },
      contextInfo: {
        forwardingScore: 999,
        isForwarded: true
      }
    }

    try {
      // JID Resmi Meta AI Bot WhatsApp
      const aiJid = '867051314767696@bot'
      const aiPhoneJid = '13135550002@s.whatsapp.net'
      let updateResult = null

      // Method 1: Zapo-JS Native Group Coordinator (client.group.addParticipants)
      if (typeof client?.group?.addParticipants === 'function') {
        try {
          updateResult = await client.group.addParticipants(groupJid, [aiJid])
        } catch {
          updateResult = await client.group.addParticipants(groupJid, [aiPhoneJid])
        }
      }
      // Method 2: Standard Baileys Compatibility Layer (groupParticipantsUpdate)
      else if (typeof client?.groupParticipantsUpdate === 'function') {
        try {
          updateResult = await client.groupParticipantsUpdate(groupJid, [aiJid], 'add')
        } catch {
          updateResult = await client.groupParticipantsUpdate(groupJid, [aiPhoneJid], 'add')
        }
      }
      // Method 3: client.group.participantsUpdate
      else if (typeof client?.group?.participantsUpdate === 'function') {
        updateResult = await client.group.participantsUpdate(groupJid, [aiJid], 'add')
      }
      // Method 4: client.group.add
      else if (typeof client?.group?.add === 'function') {
        updateResult = await client.group.add(groupJid, [aiJid])
      }
      // Method 5: Fallback Low-Level Query Protocol
      else if (typeof client?.query === 'function') {
        updateResult = await client.query({
          tag: 'iq',
          attrs: {
            type: 'set',
            xmlns: 'w:g2',
            to: groupJid
          },
          content: [
            {
              tag: 'add',
              attrs: {},
              content: [{ tag: 'participant', attrs: { jid: aiJid } }]
            }
          ]
        })
      } else {
        throw new Error('Metode group coordinator tidak ditemukan pada socket Zapo-JS.')
      }

      // Evaluasi hasil respons WhatsApp server jika berbentuk array status
      if (Array.isArray(updateResult) && updateResult.length > 0) {
        const status = String(updateResult[0]?.status || '')
        if (status === '403') {
          return await m.reply('⚠️ Tidak dapat menambahkan Meta AI secara langsung karena pengaturan privasi grup atau bot belum menjadi admin.')
        } else if (status === '408') {
          return await m.reply('⚠️ Meta AI baru saja keluar dari grup ini. Silakan coba lagi beberapa saat.')
        } else if (status === '409') {
          return await m.reply('ℹ️ Meta AI sudah ada di dalam grup ini.')
        }
      }

      await sock.message.send(m.jid, { text: 'Sukses menambahkan Meta AI ke dalam grup ✅' }, { quoted: fkontak })
      if (typeof m.react === 'function') await m.react('✅')

    } catch (err) {
      console.error('[AddAI Error]', err)
      if (typeof m.react === 'function') await m.react('❌')
      
      let errMsg = err?.message || String(err)
      if (/not-authorized|admin/i.test(errMsg)) {
        errMsg = 'Bot wajib menjadi Admin grup untuk bisa menambahkan Meta AI.'
      }

      await m.reply(`❌ *Gagal menambahkan Meta AI:*\n\n${errMsg}`)
    }
  }
}