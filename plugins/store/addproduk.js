// plugins/store/addproduk.js
import fs from 'fs/promises'
import path from 'path'
import { reloadGlobalPlugins } from '../../lib/loadPlugins.js'
const PLUGINS_ROOT = path.resolve(process.cwd(), 'plugins')
const STORE_DIR = path.resolve(PLUGINS_ROOT, 'store')
const SYSTEM_FILES = ['addproduk', 'delproduk', 'listproduk']

export default {
  command: 'addproduk',
  alias: ['tambahproduk', 'addlist'],
  category: 'store',
  description: 'Menambahkan produk baru yang langsung bisa dipanggil dengan .nama',
  help: '<nama> | <isi/list harga> ATAU reply teks lalu ketik .addproduk <nama>',
  onlyOwner: true,

  async execute(m, { args = [] }) {
    const rawText = m.text?.replace(/^\S+\s*/, '') || ''
    let key = ''
    let content = ''

    // Cara 1: Reply pesan teks berisi list harga
    if (m.quoted && m.quoted.text) {
      key = args[0]?.trim().toLowerCase()
      content = m.quoted.text.trim()
    }
    // Cara 2: Ketik langsung dipisah garis vertikal |
    else if (rawText.includes('|')) {
      const parts = rawText.split('|')
      key = parts[0]?.trim().toLowerCase()
      content = parts.slice(1).join('|').trim()
    }

    if (!key || !content) {
      return m.reply(
        `📦 *Format Tambah Produk:*\n\n` +
        `*Cara 1 (Reply teks list harga):*\n` +
        `> Reply teks list harga lalu ketik: \`${m.prefix}addproduk sewabot\`\n\n` +
        `*Cara 2 (Ketik langsung):*\n` +
        `> \`${m.prefix}addproduk sewabot | LIST HARGA:\\n• 15 Hari: Rp10.000\\n• 30 Hari: Rp15.000\``
      )
    }

    // Bersihkan nama command (hanya huruf, angka, minus)
    const cleanKey = key.replace(/[^a-z0-9_-]/gi, '')
    if (!cleanKey) {
      return m.reply('❌ Nama produk tidak valid. Gunakan huruf tanpa spasi (contoh: `sewabot`, `vps`, `panel`).')
    }

    if (SYSTEM_FILES.includes(cleanKey)) {
      return m.reply(`❌ Nama \`${cleanKey}\` tidak boleh digunakan karena merupakan nama sistem.`)
    }

    await fs.mkdir(STORE_DIR, { recursive: true })

    // Generate kode plugin otomatis agar command .nama langsung ada di bot
    const pluginCode = `// plugins/store/${cleanKey}.js

export default {
  command: '${cleanKey}',
  category: 'store',
  description: 'List produk ${cleanKey}',

  async execute(m) {
    return await m.reply(${JSON.stringify(content)})
  }
}
`

    const targetFile = path.join(STORE_DIR, `${cleanKey}.js`)

    try {
      await fs.writeFile(targetFile, pluginCode, 'utf8')

      // Reload bot agar command baru langsung aktif
      try {
        await reloadGlobalPlugins(PLUGINS_ROOT)
      } catch (rErr) {
        console.warn('[RELOAD WARN]:', rErr.message)
      }

      return m.reply(
        `✅ *PRODUK BERHASIL DITAMBAHKAN!*\n\n` +
        `• *Command:* \`${m.prefix}${cleanKey}\`\n` +
        `• *Status:* Langsung aktif!\n\n` +
        `_Sekarang siapa pun bisa mengetik_ \`${m.prefix}${cleanKey}\` _untuk melihat list ini._`
      )
    } catch (err) {
      return m.reply(`❌ Gagal menyimpan produk: ${err.message}`)
    }
  }
}