// plugins/search/lirik.js
import yts from 'yt-search'
export default {
  command: 'lirik',
  alias: ['lyrics', 'lyric'],
  category: 'search',
  description: 'Mencari informasi, ringkasan makna, dan referensi lirik lagu',
  onlyOwner: false,
  async execute(m, context) {
    const { sock, args } = context
    const query = args.join(' ').trim()

    if (!query) {
      return await sock.message.send(m.jid || m.key?.remoteJid, { text: '❌ Harap masukkan judul lagu!\n\n*Contoh:* .lirik komang' }, { quoted: m })
    }

    try {
      if (m.react) await m.react('🔍')

      const search = await yts(query)
      if (!search || !search.videos || !search.videos.length) {
        if (m.react) await m.react('❌')
        return await sock.message.send(m.jid || m.key?.remoteJid, { text: '❌ Lagu tidak ditemukan!' }, { quoted: m })
      }

      const video = search.videos[0]
      const songTitle = video.title || 'Unknown Title'
      const artistName = (video.author && video.author.name) ? video.author.name : 'Unknown Artist'
      const duration = (video.duration && video.duration.timestamp) ? video.duration.timestamp : '-'

      let caption = '🎵 *INFORMASI LAGU*\n\n'
      caption += '📌 *Judul:* ' + songTitle + '\n'
      caption += '👤 *Artis:* ' + artistName + '\n'
      caption += '⏱️ *Durasi:* ' + duration + '\n'
      caption += '🔗 *Link:* ' + video.url + '\n\n'

      caption += '📝 *RINGKASAN & MAKNA LAGU*\n'
      caption += 'Lagu ini menyampaikan pesan emosional, tema kehidupan, dan ekspresi perasaan yang dituangkan oleh ' + artistName + ' melalui melodi serta liriknya.\n\n'

      caption += '🔍 *LIRIK LENGKAP:*\n'
      caption += 'Untuk membaca lirik lengkap terlisensi dari lagu ini, Anda dapat mencarinya langsung di Google Search dengan kata kunci: "' + songTitle + ' lyrics".'

      if (m.react) await m.react('✅')

      const targetJid = m.jid || m.key?.remoteJid
      if (video.thumbnail) {
        await sock.message.send(targetJid, {
          image: { url: video.thumbnail },
          caption: caption
        }, { quoted: m })
      } else {
        await sock.message.send(targetJid, { text: caption }, { quoted: m })
      }

    } catch (error) {
      console.error('[LIRIK ERROR]', error)
      if (m.react) await m.react('❌')
      const targetJid = m.jid || m.key?.remoteJid
      if (targetJid) {
        await sock.message.send(targetJid, { text: '❌ Gagal memproses data lagu. Silakan coba lagi nanti.' }, { quoted: m })
      }
    }
  }
}