// plugins/konvert/sticker.js
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import * as settings from '../../settings.js'
const config = settings.config || settings.default || settings
const TMP_DIR = path.resolve('/home/container/tmp')

function isUrl(text = '') {
  return /^https?:\/\/\S+$/i.test(String(text).trim())
}

async function urlToBuffer(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Gagal mengambil media dari URL (${response.status})`)
  return Buffer.from(await response.arrayBuffer())
}

// Injeksi EXIF Packname & Author (Zero-Dependency Buffer)
function addExifToWebp(webpBuffer, packname, author) {
  if (!Buffer.isBuffer(webpBuffer) || webpBuffer.length < 12) return webpBuffer

  const json = {
    'sticker-pack-id': 'https://github.com/gustodx',
    'sticker-pack-name': packname,
    'sticker-pack-publisher': author,
    'emojis': ['✨']
  }

  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00
  ])

  const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8')
  const exifPayload = Buffer.concat([exifAttr, jsonBuffer])
  exifPayload.writeUIntLE(jsonBuffer.length, 14, 4)

  const exifSize = exifPayload.length
  const padding = exifSize % 2 !== 0 ? Buffer.from([0x00]) : Buffer.alloc(0)
  const exifHeader = Buffer.alloc(8)
  exifHeader.write('EXIF', 0, 4, 'ascii')
  exifHeader.writeUInt32LE(exifSize, 4)
  const exifChunk = Buffer.concat([exifHeader, exifPayload, padding])

  if (webpBuffer.toString('ascii', 0, 4) !== 'RIFF' || webpBuffer.toString('ascii', 8, 12) !== 'WEBP') {
    return webpBuffer
  }

  const firstChunkFourCC = webpBuffer.toString('ascii', 12, 16)

  if (firstChunkFourCC === 'VP8X') {
    const flags = webpBuffer.readUInt8(20)
    webpBuffer.writeUInt8(flags | 0x08, 20)

    let offset = 20 + 10
    let foundExif = -1
    let exifChunkLen = 0

    while (offset < webpBuffer.length) {
      const chunkName = webpBuffer.toString('ascii', offset, offset + 4)
      const chunkSize = webpBuffer.readUInt32LE(offset + 4)
      const chunkTotal = 8 + chunkSize + (chunkSize % 2 !== 0 ? 1 : 0)
      if (chunkName === 'EXIF') {
        foundExif = offset
        exifChunkLen = chunkTotal
        break
      }
      offset += chunkTotal
    }

    const newBody = foundExif !== -1
      ? Buffer.concat([webpBuffer.slice(12, foundExif), exifChunk, webpBuffer.slice(foundExif + exifChunkLen)])
      : Buffer.concat([webpBuffer.slice(12), exifChunk])

    const newRiff = Buffer.alloc(12)
    newRiff.write('RIFF', 0, 4, 'ascii')
    newRiff.writeUInt32LE(newBody.length + 4, 4)
    newRiff.write('WEBP', 8, 4, 'ascii')

    return Buffer.concat([newRiff, newBody])
  } else {
    let width = 512
    let height = 512

    if (firstChunkFourCC === 'VP8 ') {
      width = webpBuffer.readUInt16LE(26) & 0x3fff
      height = webpBuffer.readUInt16LE(28) & 0x3fff
    } else if (firstChunkFourCC === 'VP8L') {
      const b1 = webpBuffer.readUInt8(21)
      const b2 = webpBuffer.readUInt8(22)
      const b3 = webpBuffer.readUInt8(23)
      const b4 = webpBuffer.readUInt8(24)
      width = 1 + (((b2 & 0x3f) << 8) | b1)
      height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6))
    }

    const vp8xHeader = Buffer.alloc(18)
    vp8xHeader.write('VP8X', 0, 4, 'ascii')
    vp8xHeader.writeUInt32LE(10, 4)
    vp8xHeader.writeUInt8(0x08, 8)
    vp8xHeader.writeUInt8(0, 9)
    vp8xHeader.writeUInt8(0, 10)
    vp8xHeader.writeUInt8(0, 11)
    vp8xHeader.writeUIntLE(Math.max(0, width - 1), 12, 3)
    vp8xHeader.writeUIntLE(Math.max(0, height - 1), 15, 3)

    const newBody = Buffer.concat([vp8xHeader, webpBuffer.slice(12), exifChunk])

    const newRiff = Buffer.alloc(12)
    newRiff.write('RIFF', 0, 4, 'ascii')
    newRiff.writeUInt32LE(newBody.length + 4, 4)
    newRiff.write('WEBP', 8, 4, 'ascii')

    return Buffer.concat([newRiff, newBody])
  }
}

// Download Media Universal (Aman untuk Berbagai Struktur Zapo-JS)
async function getMediaBuffer(targetMedia, sock) {
  try {
    if (typeof targetMedia?.download === 'function') {
      const buf = await targetMedia.download()
      if (Buffer.isBuffer(buf) && buf.length > 0) return buf
    }

    const payloadTarget = targetMedia?.full || targetMedia?.raw || targetMedia

    if (typeof sock?.message?.downloadBytes === 'function') {
      const buf = await sock.message.downloadBytes(payloadTarget)
      if (Buffer.isBuffer(buf) && buf.length > 0) return buf
    }

    if (typeof sock?.message?.download === 'function') {
      const buf = await sock.message.download(payloadTarget)
      if (Buffer.isBuffer(buf) && buf.length > 0) return buf
    }

    if (typeof sock?.downloadMedia === 'function') {
      const buf = await sock.downloadMedia(payloadTarget)
      if (Buffer.isBuffer(buf) && buf.length > 0) return buf
    }

    if (Buffer.isBuffer(targetMedia?.buffer || targetMedia?.media)) {
      return targetMedia.buffer || targetMedia.media
    }
  } catch (err) {
    console.error('[DOWNLOAD MEDIA ERROR]', err?.message || err)
  }

  throw new Error('Gagal mengunduh media dari pesan.')
}

// Konversi Media ke WebP dengan Sintaks Filter FFmpeg yang Benar
async function convertToWebp(mediaBuffer, isVideo = false) {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })
  const id = `stk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const inPath = path.join(TMP_DIR, `${id}.${isVideo ? 'mp4' : 'png'}`)
  const outPath = path.join(TMP_DIR, `${id}.webp`)

  fs.writeFileSync(inPath, mediaBuffer)

  // Filter 512x512 standar WhatsApp tanpa typo kutip
  const ffmpegArgs = isVideo
    ? [
        '-y',
        '-i', inPath,
        '-t', '10',
        '-vcodec', 'libwebp',
        '-filter:v', 'scale=512:512:force_original_aspect_ratio=decrease,fps=12,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
        '-lossless', '0',
        '-compression_level', '4',
        '-q:v', '40',
        '-loop', '0',
        '-preset', 'default',
        '-an',
        '-vsync', '0',
        outPath
      ]
    : [
        '-y',
        '-i', inPath,
        '-vcodec', 'libwebp',
        '-filter:v', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
        '-lossless', '0',
        '-compression_level', '4',
        '-q:v', '75',
        outPath
      ]

  try {
    await new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', ffmpegArgs)
      let stderr = ''
      ff.stderr.on('data', d => { stderr += d })
      ff.on('error', reject)
      ff.on('close', code => (code === 0 ? resolve() : reject(new Error(`FFmpeg exit ${code}: ${stderr.slice(-200)}`))))
    })
    return fs.readFileSync(outPath)
  } finally {
    if (fs.existsSync(inPath)) fs.unlinkSync(inPath)
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath)
  }
}

// Helper Reaksi Anti-Crash
async function safeReact(sock, m, emoji) {
  try {
    if (typeof m.react === 'function') {
      return await m.react(emoji)
    }
    if (typeof sock?.sendReact === 'function') {
      return await sock.sendReact(m.jid, emoji, m.id || m.key?.id)
    }
    if (typeof sock?.message?.react === 'function') {
      return await sock.message.react(m.jid, emoji, m.key)
    }
  } catch {}
}

export default {
  command: 'sticker',
  alias: ['stiker', 's', 'sgif', 'stikergif', 'stickergif'],
  category: 'konvert',
  description: 'Mengubah gambar, video, stiker, atau URL menjadi stiker WhatsApp',

  async execute(m, context) {
    const { sock, args } = context

    try {
      const targetMedia = m.quoted ? m.quoted : m
      const mime = targetMedia.mimetype || targetMedia.mime || targetMedia.mediaType || targetMedia.msg?.mimetype || ''
      const type = targetMedia.type || targetMedia.mtype || ''

      const isMediaMessage = Boolean(
        targetMedia.isMedia ||
        /image|video|webp|sticker/i.test(mime) ||
        /image|video|sticker/i.test(type)
      )

      if (!isMediaMessage && !(args[0] && isUrl(args[0]))) {
        const usedPrefix = m.prefix || '.'
        const command = m.command || 'sticker'
        throw new Error(`Reply gambar/video/stiker lalu ketik *${usedPrefix}${command}* atau kirim link gambar.`)
      }

      let [inputPack, ...inputAuth] = args.join(' ').split('|')
      const packname = inputPack?.trim() || config?.packname || 'WhatsApp Bot'
      const author = (inputAuth || []).join('|').trim() || config?.author || 'gustodx'

      let source
      let isVideo = false

      if (isMediaMessage) {
        const seconds = Number(targetMedia.raw?.message?.videoMessage?.seconds || targetMedia.msg?.seconds || 0)
        if (/video/i.test(mime) && seconds > 10) {
          throw new Error('Durasi video maksimal 10 detik untuk stiker animasi.')
        }

        isVideo = /video/i.test(mime) || /video/i.test(type)
        source = await getMediaBuffer(targetMedia, sock)
      } else if (args[0] && isUrl(args[0])) {
        source = await urlToBuffer(args[0])
      }

      await safeReact(sock, m, '⏳')

      // Jika yang di-reply sudah berupa stiker (WebP), langsung injek EXIF tanpa perlu render ulang
      let stickerBuffer
      if (/webp|sticker/i.test(mime) && !isVideo) {
        stickerBuffer = addExifToWebp(source, packname, author)
      } else {
        const rawWebp = await convertToWebp(source, isVideo)
        stickerBuffer = addExifToWebp(rawWebp, packname, author)
      }

      // Kirim stiker
      if (sock?.message?.send) {
        await sock.message.send(
          m.jid,
          {
            type: 'sticker',
            media: stickerBuffer,
            sticker: stickerBuffer
          },
          { quote: m.raw || m }
        )
      } else {
        await m.reply({ sticker: stickerBuffer })
      }

      await safeReact(sock, m, '✅')
    } catch (error) {
      console.error('[STICKER ERROR]', error?.message || error)
      await safeReact(sock, m, '❌')
      return m.reply(`❌ Gagal membuat stiker:\n${error?.message || error}`)
    }
  }
}