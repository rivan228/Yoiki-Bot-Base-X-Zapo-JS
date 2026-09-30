// plugins/store/delproduk.js
import fs from 'fs/promises'
import path from 'path'
import { reloadGlobalPlugins } from '../../lib/loadPlugins.js'
const PLUGINS_ROOT = path.resolve(process.cwd(), 'plugins')
const STORE_DIR = path.resolve(PLUGINS_ROOT, 'store')
const SYSTEM_FILES = ['addproduk', 'delproduk', 'listproduk']

export default {
  command: 'delproduk',
  alias: ['hapusproduk', 'dellist'],
  category: 'store',
  description: 'Menghapus produk dari toko',
  help: '<nama_produk>',
  onlyOwner: true,

  async execute(m, { args = [] }) {
    const key = args[0]?.trim().toLowerCase().replace(/[^a-z0-9_-]/gi, '')

    if (!key) {
      return m.reply(`Tentukan nama produk yang mau dihapus.\nContoh: \`${m.prefix}delproduk sewabot\``)
    }

    if (SYSTEM_FILES.includes(key)) {
      return m.reply(`❌ Tidak bisa menghapus command sistem \`${key}\`.`)
    }

    const targetFile = path.join(STORE_DIR, `${key}.js`)

    try {
      const exists = await fs.access(targetFile).then(() => true).catch(() => false)
      if (!exists) {
        return m.reply(`❌ Produk \`${key}\` tidak ditemukan di toko.`)
      }

      await fs.unlink(targetFile)

      try {
        await reloadGlobalPlugins(PLUGINS_ROOT)
      } catch (rErr) {
        console.warn('[RELOAD WARN]:', rErr.message)
      }

      return m.reply(`🗑️ Produk \`${key}\` berhasil dihapus dan command \`${m.prefix}${key}\` telah dinonaktifkan.`)
    } catch (err) {
      return m.reply(`❌ Gagal menghapus produk: ${err.message}`)
    }
  }
}