// plugins/tools/bypass.js
import { config } from '../../settings.js'
export default {
  command: 'bypasslink',
  alias: ['bypass', 'shortlinkbypass', 'safelinkbypass'],
  category: 'tools',
  description: 'Bypass / lewati tautan iklan shortlink (Ouou, Safelink, Shorturl, dll)',
  onlyOwner: false,

  async execute(m, context) {
    const { sock, args } = context

    const text = (args || []).join(' ').trim()
    if (!text) {
      return await m.reply(
        `🔓 *SHORTLINK BYPASS*\n\nLewati tautan iklan dan shortlink (Safelink, Ouou, Shorturl, dll)!\nContoh:\n.bypass https://ouo.io/xxxx`
      )
    }

    if (typeof m.react === 'function') await m.react('⏳')

    try {
      const url = text
      const apiKey = config?.apikey?.jereapi || global.apikey?.jereapi || ''
      const webUrl = config?.web || global.web || ''

      if (!webUrl) {
        throw new Error('URL API (config.web) belum dikonfigurasi pada settings.js')
      }

      const apiUrl = `${webUrl}/api/tools/bypasslink?apikey=${apiKey}`

      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(15000)
      })

      const json = await res.json()
      if (!json.status) {
        throw new Error(json.error || json.detail || 'Gagal melakukan bypass pada link tersebut.')
      }

      const data = json.result || {}
      
      let caption = `🔓 *BYPASS LINK BERHASIL*\n\n`
      caption += `🔗 *Original URL:*\n${data.original_url || url}\n\n`
      caption += `🎯 *Bypassed URL:*\n${data.bypassed_url || '-'}\n\n`
      caption += `🌐 *Platform:* ${data.platform || 'Unknown'}\n\n`
      caption += `✅ *Request by:* ${m.pushName || 'User'}`

      // Quoted Fake Metadata WhatsApp Business (Sesuai Kustomisasi Aktif)
      const fkontak = {
        key: {
          participant: '0@s.whatsapp.net',
          remoteJid: 'status@broadcast'
        },
        message: {
          contactMessage: {
            displayName: 'gustodx',
            vcard: `BEGIN:VCARD\nVERSION:3.0\nN:;gustodx;;;\nFN:gustodx\nORG:WhatsApp Business • Status\nTITLE:⤹ Diteruskan\nEND:VCARD`
          }
        }
      }

      await m.reply(caption, { quoted: fkontak })
      if (typeof m.react === 'function') await m.react('✅')

    } catch (err) {
      if (typeof m.react === 'function') await m.react('❌')
      await m.reply(`❌ *Bypass Gagal*\nError: ${err.message}`)
    }
  }
}