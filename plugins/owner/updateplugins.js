// plugins/owner/updateplugins.js
import fs from 'fs/promises'
import path from 'path'
import { reloadGlobalPlugins } from '../../lib/loadPlugins.js'
const PLUGINS_ROOT = path.resolve(process.cwd(), 'plugins')

/**
 * Membersihkan format blok kode markdown (```js ... ```) jika ada
 */
export function cleanSourceCode(raw) {
  if (!raw) return ''
  let text = String(raw).trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z0-9_-]*\r?\n/, '')
    text = text.replace(/\r?\n```$/, '')
  }
  return text.trim()
}

/**
 * Membaca teks source baik dari quoted message, caption, atau document
 */
export async function readPluginSource(m) {
  const quoted = m.quoted
  if (!quoted) return null

  // Jika quoted adalah dokumen/file .js
  if (quoted.mediaType === 'document' || quoted.type === 'documentMessage' || quoted.mimetype) {
    if (typeof quoted.download === 'function') {
      const buffer = await quoted.download()
      if (buffer) return Buffer.from(buffer).toString('utf8')
    }
  }

  // Jika quoted berupa teks biasa atau caption media
  const text = quoted.text || quoted.caption || quoted.body || quoted.conversation
  if (text) return String(text)

  return null
}

export function extractPluginInfo(source) {
  const command = source.match(/\bcommand\s*:\s*['"`]([^'"`]+)['"`]/i)?.[1]?.trim().toLowerCase()
  const aliasBlock = source.match(/\balias(?:es)?\s*:\s*(\[[\s\S]*?\]|['"`][^'"`]+['"`])/i)?.[1] || ''
  const aliases = [...aliasBlock.matchAll(/['"`]([^'"`]+)['"`]/g)]
    .map(([, alias]) => alias.trim().toLowerCase())
    .filter(Boolean)

  return { command, aliases }
}

/**
 * Mencari path file di 10 baris pertama komentar (misal: // plugins/tools/qris.js)
 */
export function extractSourcePath(source) {
  const lines = source.split(/\r?\n/).slice(0, 10)
  for (const line of lines) {
    const match = line.match(/^\s*(?:\/\/|\/\*)\s*(plugins\/[^\s*]+\.js)/i)
    if (match) return match[1]
  }
  return null
}

export function resolvePluginPath(input) {
  let normalized = String(input || '').trim().replaceAll('\\', '/')
  if (!normalized) return null

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

  // Validasi agar tidak bisa menimpa file di luar folder plugins (security)
  const relativeToRoot = path.relative(PLUGINS_ROOT, fullPath)
  if (!relativeToRoot || relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    return null
  }

  if (!fullPath.endsWith('.js')) return null
  return fullPath
}

export function findMatchingPlugin(plugins, info) {
  if (!plugins) return null
  const getPlugin = (key) => (typeof plugins.get === 'function' ? plugins.get(key) : plugins[key])

  for (const key of [info.command, ...info.aliases]) {
    if (key && getPlugin(key)) return getPlugin(key)
  }
  return null
}

export function pluginUsage(m, command = m.command) {
  return `*Format Penggunaan:*\n> Reply pesan teks/document berisi source plugin lalu ketik: ${m.prefix}${command} [opsional: path/tujuan.js]`
}

export function sourceInputError(m) {
  if (!m.quoted) {
    return `Reply pesan teks atau document berisi source plugin terlebih dahulu.\n\n${pluginUsage(m)}`
  }
  return `Source plugin kosong atau tidak dapat dibaca.\n\n${pluginUsage(m)}`
}

export async function savePluginSource(fullPath, source) {
  await fs.mkdir(path.dirname(fullPath), { recursive: true })
  await fs.writeFile(fullPath, source, 'utf8')
}

export async function reloadPlugins() {
  const result = await reloadGlobalPlugins(PLUGINS_ROOT)
  if (result.errors) {
    throw new Error(`Reload selesai namun ada ${result.errors} plugin yang error.`)
  }
  return result
}

export default {
  command: 'updateplugins',
  alias: ['pluginsupdate', 'updateplugin', 'upplugin'],
  category: 'owner',
  description: 'Memperbarui atau menimpa source plugin secara langsung.',
  help: '(reply text/document) [path]',
  onlyOwner: true,

  async execute(m, { plugins, args = [] }) {
    let rawSource

    try {
      rawSource = await readPluginSource(m)
    } catch (err) {
      return m.reply(`Gagal membaca source plugin: ${err.message}\n\n${pluginUsage(m)}`)
    }

    if (!rawSource?.trim()) return m.reply(sourceInputError(m))

    // Bersihkan markdown code block jika user membalas kode dari chat GPT/WA
    const source = cleanSourceCode(rawSource)
    const info = extractPluginInfo(source)

    let targetFilePath = null
    let displayPath = ''

    // 1. Cek jika user menyertakan path manual di argumen (misal: .updateplugins tools/qris.js)
    if (args[0]) {
      targetFilePath = resolvePluginPath(args[0])
      displayPath = args[0]
    }

    // 2. Jika tidak ada argumen, cari kecocokan di memori plugins
    if (!targetFilePath && info.command) {
      const matched = findMatchingPlugin(plugins, info)
      const matchedSource = matched?.source || matched?.filePath || matched?.file
      if (matchedSource) {
        targetFilePath = resolvePluginPath(matchedSource)
        displayPath = matchedSource
      }
    }

    // 3. Jika plugin belum terdaftar (atau sedang crash), ambil dari komentar path pada kode (// plugins/...)
    if (!targetFilePath) {
      const detectedPath = extractSourcePath(source)
      if (detectedPath) {
        targetFilePath = resolvePluginPath(detectedPath)
        displayPath = detectedPath
      }
    }

    // Jika target file masih belum ditemukan
    if (!targetFilePath) {
      return m.reply(
        `❌ Lokasi file tidak dapat ditentukan.\n\n` +
        `Pastikan di bagian paling atas source code terdapat komentar path, contoh:\n` +
        `\`// plugins/tools/qris.js\`\n\n` +
        `Atau tentukan path secara manual:\n` +
        `> ${m.prefix}${m.command} plugins/tools/qris.js`
      )
    }

    // Simpan file dan reload
    try {
      await savePluginSource(targetFilePath, source)

      try {
        const result = await reloadPlugins()
        return m.reply(
          `✅ *Plugin Berhasil Disimpan & Di-reload!*\n\n` +
          `• Command: \`${info.command || '-'}\`\n` +
          `• Path: \`${displayPath}\`\n` +
          `• Total Loaded: ${result.loaded || 'OK'}`
        )
      } catch (reloadErr) {
        return m.reply(
          `⚠️ File berhasil disimpan di \`${displayPath}\`,\n` +
          `tetapi reload masih error: ${reloadErr.message}`
        )
      }
    } catch (saveErr) {
      return m.reply(`❌ Gagal menyimpan file ke disk: ${saveErr.message}`)
    }
  }
}