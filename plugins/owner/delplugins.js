// plugins/owner/delplugins.js
import fs from 'fs/promises'
import path from 'path'
import { reloadGlobalPlugins } from '../../lib/loadPlugins.js'
const PLUGINS_DIR = path.resolve(process.cwd(), 'plugins')

/**
 * Normalisasi path agar selalu mengarah ke dalam folder plugins/
 */
function resolvePluginFullPath(input) {
  if (!input) return null
  let normalized = String(input).trim().replaceAll('\\', '/')

  let fullPath
  if (path.isAbsolute(normalized)) {
    fullPath = path.normalize(normalized)
  } else {
    normalized = normalized.replace(/^\.\//, '')
    const pluginPath = normalized.startsWith('plugins/')
      ? normalized
      : `plugins/${normalized}`
    fullPath = path.resolve(process.cwd(), pluginPath)
  }

  if (!path.extname(fullPath)) fullPath += '.js'

  // Keamanan: Cegah path traversal keluar dari folder plugins
  const relativeToRoot = path.relative(PLUGINS_DIR, fullPath)
  if (!relativeToRoot || relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    return null
  }

  if (!fullPath.endsWith('.js')) return null
  return fullPath
}

function findMatchingPlugin(plugins, key) {
  if (!plugins || !key) return null
  const k = key.toLowerCase().trim()
  return typeof plugins.get === 'function' ? plugins.get(k) : plugins[k]
}

/**
 * Mencari file fisik di dalam subfolder plugins jika plugin tidak ada di memori
 */
async function searchPluginFile(fileName) {
  const cleanName = fileName.replace(/\.js$/i, '') + '.js'
  try {
    const categories = await fs.readdir(PLUGINS_DIR, { withFileTypes: true })
    for (const cat of categories) {
      if (cat.isDirectory()) {
        const potentialPath = path.join(PLUGINS_DIR, cat.name, cleanName)
        const exists = await fs.access(potentialPath).then(() => true).catch(() => false)
        if (exists) return potentialPath
      }
    }
  } catch {
    return null
  }
  return null
}

export default {
  command: 'delplugins',
  alias: ['delplugin', 'deleteplugin', 'removeplugin', 'df'],
  category: 'owner',
  description: 'Menghapus file plugin berdasarkan command, alias, atau path file.',
  help: '<command / nama file / path>',
  onlyOwner: true,

  async execute(m, { args = [], plugins }) {
    const input = args[0]?.trim()

    if (!input) {
      return m.reply(
        `Tentukan command, alias, atau path plugin yang ingin dihapus.\n\n` +
        `*Contoh:*\n` +
        `> ${m.prefix}${m.command} qris\n` +
        `> ${m.prefix}${m.command} tools/qris.js`
      )
    }

    let targetFile = null
    let pluginName = input

    // 1. Cek apakah ada di memori plugins aktif
    const plugin = findMatchingPlugin(plugins, input)
    if (plugin) {
      const source = plugin.source || plugin.filePath || plugin.file
      targetFile = resolvePluginFullPath(source)
      pluginName = plugin.command || input
    }

    // 2. Jika tidak ada di memori (misal plugin sedang error), cek sebagai path langsung
    if (!targetFile) {
      const directPath = resolvePluginFullPath(input)
      if (directPath && (await fs.access(directPath).then(() => true).catch(() => false))) {
        targetFile = directPath
      }
    }

    // 3. Jika masih belum ketemu, cari file bernama <input>.js di semua subfolder plugins/
    if (!targetFile) {
      const foundPath = await searchPluginFile(input)
      if (foundPath) {
        targetFile = foundPath
      }
    }

    if (!targetFile) {
      return m.reply(`❌ Plugin atau file \`${input}\` tidak ditemukan di memori maupun di disk.`)
    }

    // Proteksi: Jangan hapus plugin ini sendiri secara tidak sengaja
    if (path.basename(targetFile) === 'delplugins.js') {
      return m.reply('❌ Plugin `delplugins.js` tidak boleh dihapus demi keamanan bot.')
    }

    const relativeDisplay = path.relative(process.cwd(), targetFile).replaceAll('\\', '/')

    try {
      // Hapus file fisik dari server
      await fs.unlink(targetFile)

      // Reload semua plugin
      try {
        const result = await reloadGlobalPlugins(PLUGINS_DIR)
        return m.reply(
          `🗑️ *Plugin Berhasil Dihapus!*\n\n` +
          `• Target: \`${pluginName}\`\n` +
          `• Path: \`${relativeDisplay}\`\n` +
          `• Status: Reload berhasil (Loaded: ${result.loaded || 'OK'})`
        )
      } catch (reloadErr) {
        return m.reply(
          `⚠️ File \`${relativeDisplay}\` berhasil dihapus dari disk,\n` +
          `tetapi reload gagal: ${reloadErr.message}`
        )
      }
    } catch (err) {
      return m.reply(`❌ Gagal menghapus plugin: ${err.message}`)
    }
  }
}