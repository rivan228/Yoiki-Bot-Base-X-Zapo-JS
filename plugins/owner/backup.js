// plugins/owner/backup.js
import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { config } from '../../settings.js'
const execPromise = promisify(exec)

// Daftar folder & file sampah/tidak penting yang otomatis dilewati
const DEFAULT_EXCLUDES = [
  'node_modules',
  '.git',
  '.github',
  '.npm',
  '.cache',
  'tmp',
  'temp',
  'backup-tmp',
  '*.log',
  'npm-debug.log*',
  'yarn-debug.log*',
  'yarn-error.log*',
  '*.tar.gz',
  '*.zip',
  '*.tmp',
  '.DS_Store',
  'Thumbs.db',
  '.pm2'
]

/**
 * Mengambil daftar exclude tambahan dari lib/backupExclude.js jika tersedia
 */
async function getExcludeList() {
  const list = [...DEFAULT_EXCLUDES]

  try {
    const { excludeFolders = [], excludeFiles = [] } = await import('../../lib/backupExclude.js')
    const extras = [...excludeFolders, ...excludeFiles].map(p => p.replace(/^\.\//, '').replace(/\/+$/, ''))
    list.push(...extras)
  } catch {
    // Abaikan jika file lib/backupExclude.js tidak ada
  }

  // Hapus duplikat
  return Array.from(new Set(list))
}

/**
 * Mendapatkan JID nomor WhatsApp Owner (format private chat)
 */
function getOwnerTargetJid(m, botConfig) {
  let jid = m.senderAlt || m.key?.participantAlt || m.sender || m.key?.participant

  if ((!jid || jid.includes('@lid')) && botConfig?.owner) {
    const ownerNum = Array.isArray(botConfig.owner) ? botConfig.owner[0] : botConfig.owner
    if (ownerNum) {
      jid = String(ownerNum).replace(/[^0-9]/g, '') + '@s.whatsapp.net'
    }
  }

  if (jid && jid.includes(':')) {
    jid = jid.split(':')[0] + '@' + jid.split('@')[1]
  }

  return jid
}

export default {
  command: 'backup',
  alias: ['getsc', 'getscript', 'backupproject', 'bckp'],
  category: 'owner',
  description: 'Membuat backup source code project (tanpa file sampah) dan mengirimkannya ke chat pribadi Owner dalam format ZIP.',
  help: '',
  onlyOwner: true,
  typing: true,

  async execute(m, { sock }) {
    const ownerJid = getOwnerTargetJid(m, config)

    if (!ownerJid) {
      return m.reply('❌ Gagal mendeteksi nomor Owner untuk pengiriman file.')
    }

    if (sock?.sendReact) {
      await sock.sendReact(m.jid, '⏳', m.id).catch(() => {})
    }

    await m.reply('⏳ *Sedang mengompresi source code project ke ZIP...*\n_Mohon tunggu sebentar._')

    const projectRoot = process.cwd()
    const botName = (config.botName || 'bot').replace(/[^a-zA-Z0-9_-]/g, '')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const fileName = `backup-${botName}-${timestamp}.zip` // <-- Format nama .zip
    const outPath = path.join(os.tmpdir(), fileName)

    const excludes = await getExcludeList()
    
    // Format exclude untuk perintah zip (-x "pola" "pola/*")
    const excludePatterns = excludes.flatMap(item => {
      if (item.includes('*')) return [`"${item}"`]
      return [`"${item}"`, `"${item}/*"`]
    })
    const excludeArgs = excludePatterns.map(p => `-x ${p}`).join(' ')

    // Perintah kompresi ZIP
    const cmd = `cd "${projectRoot}" && zip -r "${outPath}" . ${excludeArgs}`

    try {
      try {
        await execPromise(cmd)
      } catch (err) {
        // Zip code 12 biasanya peringatan file skipped atau file yang sedang ditulis
        if (err.code !== 12 && err.code !== 1) throw err
      }

      const stat = await fs.promises.stat(outPath)
      if (!stat.size) {
        throw new Error('Hasil backup 0 byte, proses kompresi gagal.')
      }

      const sizeMB = (stat.size / 1024 / 1024).toFixed(2)

      const caption =
        `*── 「 BACKUP PROJECT (ZIP) 」 ──*\n\n` +
        `👤 *Pemilik:* ${m.pushName || 'Owner'}\n` +
        `📄 *File:* \`${fileName}\`\n` +
        `📦 *Ukuran:* ${sizeMB} MB\n` +
        `📅 *Waktu:* ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n\n` +
        `_File project ini telah dibersihkan dari node_modules, cache, dan file sampah._`

      // Kirim dokumen ke private chat nomor Owner
      await sock.message.send(ownerJid, {
        type: 'document',
        media: outPath,
        mimetype: 'application/zip', // <-- Mimetype diubah ke application/zip
        fileName,
        caption
      })

      if (sock?.sendReact) {
        await sock.sendReact(m.jid, '✅', m.id).catch(() => {})
      }

      if (m.isGroup) {
        return await m.reply(
          `✅ *Backup Project Berhasil!*\n\n` +
          `📦 Ukuran: *${sizeMB} MB*\n` +
          `📤 File ZIP telah dikirim ke *Chat Pribadi (DM)* kamu demi keamanan.`
        )
      } else {
        return await m.reply(`✅ *Backup Berhasil!* File project (ZIP) telah dikirim di atas.`)
      }

    } catch (err) {
      console.error('[BACKUP ERROR]:', err?.stack || err)
      if (sock?.sendReact) {
        await sock.sendReact(m.jid, '❌', m.id).catch(() => {})
      }
      return m.reply(`❌ *Gagal membuat backup:*\n\n${err.message || err}`)
    } finally {
      // Hapus file sementara di folder /tmp
      await fs.promises.unlink(outPath).catch(() => {})
    }
  }
}