// plugins/owner/playch.js
import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import * as settings from '../../settings.js'
const config = settings.config || settings.default || settings
const execPromise = promisify(exec)
const API_URL = 'https://api.neosoft.best/api/downloader/youtube-play'
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

// Fake Quoted Meta Verified
const fmeta = {
    key: {
        fromMe: false,
        participant: '0@s.whatsapp.net',
        remoteJid: 'status@broadcast'
    },
    message: {
        contactMessage: {
            displayName: 'gustodx',
            vcard: 'BEGIN:VCARD\nVERSION:3.0\nN:;gustodx;;;\nFN:gustodx\nORG:WhatsApp Business • Status\nitem1.TEL;waid=0:+0\nitem1.X-ABLabel:⤹ Diteruskan\nEND:VCARD'
        }
    }
}

async function safeReply(m, text) {
    try {
        return await m.reply(text, { quoted: fmeta })
    } catch {
        return await m.reply(text)
    }
}

// Dispatcher khusus Channel (Bypass quote injection messageHandler)
async function sendToChannel(sock, jid, content, context = {}) {
    const cleanOptions = {
        quote: null,
        quoted: null,
        quotedMessage: null
    }

    try {
        const proto = Object.getPrototypeOf(sock?.message || {})
        if (proto && typeof proto.send === 'function' && proto.send !== sock?.message?.send) {
            return await proto.send.call(sock.message, jid, content, cleanOptions)
        }
    } catch (err) {
        if (!err.message?.includes('quote')) throw err
    }

    const rawClient = context?.client || sock?.client || sock?.waClient || sock?._client
    if (rawClient?.message?.send && rawClient.message.send !== sock?.message?.send) {
        try {
            return await rawClient.message.send(jid, content, cleanOptions)
        } catch (err) {
            if (!err.message?.includes('quote')) throw err
        }
    }

    if (sock?.message?.send) {
        return await sock.message.send(jid, content, cleanOptions)
    }

    if (sock?.sendMessage) {
        return await sock.message.send(jid, content, cleanOptions)
    }

    throw new Error('Socket sender method tidak ditemukan')
}

async function getThumb(url) {
    if (!url) return null
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 15000
        })
        const buf = Buffer.from(response.data)

        try {
            const jimpMod = await import('jimp').catch(() => null)
            const Jimp = jimpMod?.Jimp || jimpMod?.default
            if (Jimp) {
                const image = await Jimp.read(buf)
                if (typeof image.cover === 'function') image.cover(1280, 720)
                if (typeof image.getBuffer === 'function') return await image.getBuffer('image/jpeg', { quality: 90 })
                if (typeof image.getBufferAsync === 'function') return await image.getBufferAsync('image/jpeg')
            }
        } catch {
            return buf
        }
        return buf
    } catch (e) {
        console.error('[PLAYCH THUMB ERROR]', e.message)
        return null
    }
}

async function createHighQualityThumbnail(sock, thumb) {
    if (!thumb) return null
    try {
        const baileys = await import('@whiskeysockets/baileys').catch(() => null)
        if (!baileys?.prepareWAMessageMedia) return null

        const uploadFn = sock?.waUploadToServer || sock?.uploadMedia
        if (!uploadFn) return null

        const { imageMessage } = await baileys.prepareWAMessageMedia(
            { image: thumb },
            { upload: uploadFn, mediaTypeOverride: 'thumbnail-link' }
        )
        if (imageMessage) {
            imageMessage.width = 1280
            imageMessage.height = 720
        }
        return imageMessage
    } catch {
        return null
    }
}

export default {
    command: 'playch',
    alias: ['playchannel', 'chplay'],
    category: 'owner',
    description: 'Putar dan kirim lagu YouTube ke Channel WhatsApp',
    onlyOwner: true,
    async execute(m, context) {
        const { sock, args } = context
        const text = args.join(' ').trim()

        const channelId = config?.idch || config?.channelId || global?.info?.idch || ''
        const channelLink = config?.linkch || config?.channelLink || 'https://whatsapp.com/channel/0029VbDvzjlDzgTJY34zxT1H'

        if (!text) {
            return safeReply(
                m,
                `╭─❏ 𝗣𝗹𝗮𝘆 𝗖𝗵𝗮𝗻𝗻𝗲𝗹\n│\n│✧ Masukkan judul lagu!\n│\n│✧ Format:\n│ .playch <judul lagu>\n│\n│✧ Contoh:\n│ .playch lofi hip hop\n│\n╰──────────────❏`
            )
        }

        if (!channelId || channelId.includes('xxxxxx')) {
            return safeReply(
                m,
                `╭─❏ 𝗣𝗹𝗮𝘆 𝗖𝗵𝗮𝗻𝗻𝗲𝗹\n│\n│✧ ID Channel belum diatur di settings.js (idch)!\n│\n╰──────────────❏`
            )
        }

        await m.react?.('⏳').catch(() => {})
        let inputPath = null
        let outputPath = null

        try {
            const { data } = await axios.get(API_URL, {
                params: {
                    q: text,
                    type: 'mp3'
                },
                timeout: 30000
            })

            if (!data || !data.status || !data.download) {
                throw new Error('Audio tidak ditemukan')
            }

            const title = data.title || text
            const artist = data.artist || 'Unknown'
            const thumbnail = data.thumbnail || ''
            const source = data.source || ''
            const duration = data.durationText || '-'
            const views = Number(data.views || 0).toLocaleString('id-ID')
            const uploaded = data.uploadedAt || '-'
            const downloadUrl = data.download

            const thumb = await getThumb(thumbnail)
            const highQualityThumbnail = await createHighQualityThumbnail(sock, thumb)
            const invisible = '\u200B'.repeat(400)
            const caption = `┈─ ◦ now playing ◦ ─┈\n🎵 ${title}\n👤 ${artist}\n⏱️ ${duration}\n👁️ ${views}\n📆 ${uploaded}\n⏳ sedang memproses audio...`

            // 1. KIRIM CARD NOW PLAYING KE SALURAN
            let cardSent = false
            try {
                if (source) {
                    const linkPreviewMeta = {
                        'matched-text': source,
                        matchedText: source,
                        canonicalUrl: source,
                        title,
                        description: `🎧 Audio • ${duration}`,
                        previewType: 0,
                        jpegThumbnail: thumb,
                        thumbnailUrl: thumbnail,
                        linkPreviewMetadata: {
                            linkMediaDuration: Number(data.duration || 0),
                            socialMediaPostType: 4
                        }
                    }

                    if (highQualityThumbnail) {
                        linkPreviewMeta.highQualityThumbnail = highQualityThumbnail
                    }

                    await sendToChannel(sock, channelId, {
                        text: `${source}${invisible}\n${caption}`,
                        linkPreview: linkPreviewMeta,
                        favicon: thumbnail ? { url: thumbnail } : undefined
                    }, context)
                } else {
                    await sendToChannel(sock, channelId, { text: caption }, context)
                }
                cardSent = true
            } catch (errCard) {
                console.error('[PLAYCH CARD ERROR]', errCard.message)
                // Fallback kirim plain text jika preview ditolak
                await sendToChannel(sock, channelId, { text: caption }, context).catch(() => {})
                cardSent = true
            }

            // Direktori tmp di host container
            const tmpDir = path.resolve('/home/container/tmp')
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true })
            }

            const fileId = `playch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
            inputPath = path.join(tmpDir, `${fileId}.mp3`)
            outputPath = path.join(tmpDir, `${fileId}.opus`)

            // Download Audio Stream
            const audioResponse = await axios({
                method: 'GET',
                url: downloadUrl,
                responseType: 'stream',
                timeout: 120000,
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            })

            const writer = fs.createWriteStream(inputPath)
            audioResponse.data.pipe(writer)

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve)
                writer.on('error', reject)
                audioResponse.data.on('error', reject)
            })

            if (!fs.existsSync(inputPath)) {
                throw new Error('File audio tidak ditemukan')
            }

            const stats = fs.statSync(inputPath)
            if (stats.size > MAX_FILE_SIZE) {
                throw new Error('FILE_TOO_LARGE')
            }

            // Convert ke Opus WhatsApp
            await execPromise(`ffmpeg -y -i "${inputPath}" -vn -c:a libopus -ac 1 -ar 48000 -b:a 32k -application voip -map_metadata -1 "${outputPath}"`)

            if (!fs.existsSync(outputPath)) {
                throw new Error('FFmpeg gagal menghasilkan audio')
            }

            const audioBuffer = fs.readFileSync(outputPath)

            // 2. COBA KIRIM KE CHANNEL DENGAN PROTEKSI ERROR 479
            let channelAudioDelivered = false
            try {
                await sendToChannel(sock, channelId, {
                    type: 'audio',
                    media: outputPath,
                    audio: audioBuffer,
                    mimetype: 'audio/ogg; codecs=opus',
                    ptt: true
                }, context)
                channelAudioDelivered = true
            } catch (errChannelAudio) {
                // Server WhatsApp menolak audio ke saluran (Error 479), catat log tanpa gagalkan bot
                console.warn('[PLAYCH] WhatsApp server menolak media ke Channel (Error 479):', errChannelAudio.message)
            }

            // 3. KIRIM FILE AUDIO KE CHAT INI (m.jid) AGAR AUDIO PASTI DITERIMA USER
            try {
                if (sock?.message?.send) {
                    await sock.message.send(m.jid, {
                        audio: audioBuffer,
                        type: 'audio',
                        media: outputPath,
                        mimetype: 'audio/ogg; codecs=opus',
                        ptt: false,
                        fileName: `${title}.opus`
                    })
                } else if (m.reply) {
                    await m.reply({
                        audio: audioBuffer,
                        mimetype: 'audio/ogg; codecs=opus',
                        ptt: false
                    })
                }
            } catch (errLocalAudio) {
                console.warn('[PLAYCH LOCAL AUDIO ERROR]', errLocalAudio.message)
            }

            await m.react?.('✅').catch(() => {})

            const channelNote = channelAudioDelivered
                ? 'Card & File Audio terkirim ke Saluran'
                : 'Card & Link terpasang di Saluran (File audio dikirimkan ke chat ini)'

            return safeReply(
                m,
                `╭─❏ 𝗣𝗹𝗮𝘆 𝗖𝗵𝗮𝗻𝗻𝗲𝗹\n│\n│✧ Berhasil diproses!\n│\n│✧ Judul : ${title}\n│✧ Artist : ${artist}\n│✧ Durasi : ${duration}\n│✧ Views : ${views}\n│✧ Info : ${channelNote}\n│\n│✧ Channel:\n│ ${channelLink}\n│\n╰──────────────❏`
            )
        } catch (e) {
            console.error('[PLAYCH ERROR]', e)
            await m.react?.('❌').catch(() => {})

            let errorMsg = 'Terjadi kesalahan saat memproses.'
            if (e.message === 'FILE_TOO_LARGE') errorMsg = 'File terlalu besar. Maksimal 50MB.'
            else if (e.code === 'ECONNABORTED') errorMsg = 'Request timeout. Coba lagi nanti.'
            else if (e.response?.status === 404) errorMsg = 'Lagu atau audio tidak ditemukan.'
            else if (e.response?.status === 403) errorMsg = 'Download ditolak oleh server penyedia.'
            else if (e.response?.status === 429) errorMsg = 'API sedang limit (terlalu banyak request).'
            else if (e.code === 'ENOTFOUND') errorMsg = 'Server API tidak dapat dihubungi.'
            else if (e.message === 'Audio tidak ditemukan') errorMsg = 'Audio tidak ditemukan dari API.'
            else if (e.message === 'FFmpeg gagal menghasilkan audio') errorMsg = 'FFmpeg gagal mengonversi audio.'

            return safeReply(
                m,
                `╭─❏ 𝗣𝗹𝗮𝘆 𝗖𝗵𝗮𝗻𝗻𝗲L\n│\n│✧ Status : Gagal\n│✧ Error :\n│ ${errorMsg}\n│\n╰──────────────❏`
            )
        } finally {
            try {
                if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath)
                if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
            } catch (err) {
                console.error('[PLAYCH CLEANUP]', err.message)
            }
        }
    }
}