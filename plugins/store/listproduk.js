// plugins/store/listproduk.js
import fs from 'fs/promises'
import path from 'path'
const STORE_DIR = path.resolve(process.cwd(), 'plugins/store')
const SYSTEM_FILES = ['addproduk.js', 'delproduk.js', 'listproduk.js']

export default {
  command: 'listproduk',
  alias: ['list', 'katalog', 'store', 'produk'],
  category: 'store',
  description: 'Menampilkan semua daftar produk yang tersedia di toko',

  async execute(m) {
    try {
      await fs.mkdir(STORE_DIR, { recursive: true })
      const files = await fs.readdir(STORE_DIR)

      // Ambil hanya file produk (bukan file sistem)
      const productFiles = files
        .filter(f => f.endsWith('.js') && !SYSTEM_FILES.includes(f.toLowerCase()))
        .map(f => f.replace(/\.js$/i, ''))

      if (!productFiles.length) {
        return m.reply(
          `🏪 *KATALOG TOKO KOSONG*\n\n` +
          `Belum ada list produk yang ditambahkan.\n` +
          `Owner bisa menambah produk dengan cara: \`${m.prefix}addproduk\``
        )
      }

      let text = `🏪 *KATALOG PRODUK TOKO*\n\n`
      text += `Ketik command di bawah untuk melihat list harga & detail:\n\n`

      productFiles.forEach((prod, idx) => {
        text += `${idx + 1}. *${m.prefix}${prod}*\n`
      })

      text += `\n_Total: ${productFiles.length} Produk Tersedia_\n`
      text += `_Untuk pembayaran via QRIS: ketik \`${m.prefix}qris <nominal>\`_`

      return m.reply(text)
    } catch (err) {
      return m.reply(`❌ Gagal membaca list produk: ${err.message}`)
    }
  }
}