// plugins/owner/cleanfix.js
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

export default {
  command: 'cleanfix',
  alias: ['unwrapper', 'fixrestore', 'repairall'],
  category: 'owner',
  description: 'Membersihkan bungkus try-catch buatan dan menata ulang import ESM secara otomatis',
  onlyOwner: true,
  async execute(m, context) {
    try {
      if (m.react) await m.react('🧹')

      const rootDir = process.cwd()
      const pluginsDir = path.join(rootDir, 'plugins')

      if (!fs.existsSync(pluginsDir)) {
        if (m.react) await m.react('❌')
        return await m.reply('❌ Folder plugins tidak ditemukan.')
      }

      const getFiles = function(dir) {
        let results = []
        const list = fs.readdirSync(dir)
        for (let i = 0; i < list.length; i++) {
          const file = list[i]
          const full = path.join(dir, file)
          if (fs.statSync(full).isDirectory()) {
            results = results.concat(getFiles(full))
          } else if (file.endsWith('.js')) {
            results.push(full)
          }
        }
        return results
      }

      const files = getFiles(pluginsDir)
      let cleanedCount = 0
      let failCount = 0

      for (let i = 0; i < files.length; i++) {
        const filePath = files[i]
        const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/')
        
        // Skip file cleanfix ini sendiri
        if (relativePath.includes('cleanfix.js')) continue

        let content = ''
        try {
          content = fs.readFileSync(filePath, 'utf8')
        } catch (e) {
          failCount++
          continue
        }

        let isModified = false

        // 1. Deteksi dan Ekstrak Pernyataan Import
        const importLines = []
        const otherLines = []
        const lines = content.split('\n')

        for (let j = 0; j < lines.length; j++) {
          const line = lines[j]
          // Filter baris import ESM
          if (/^\s*import\s+.+from\s+['"].+['"]/.test(line) || /^\s*import\s+['"].+['"]/.test(line)) {
            importLines.push(line.trim())
            isModified = true
          } else {
            otherLines.push(line)
          }
        }

        let bodyText = otherLines.join('\n')

        // 2. Hapus Pembungkus Auto-Repaired buatan
        if (bodyText.includes('// Auto-repaired code') || bodyText.includes('// Auto-repaired code structure')) {
          bodyText = bodyText
            .replace(/\/\/ Auto-repaired code[^\n]*/g, '')
            .replace(/\/\/ Auto-repaired code structure[^\n]*/g, '')
            .replace(/try\s*\{/g, '')
            .replace(/}\s*catch\s*\([^\)]*\)\s*\{\s*console\.error[^\}]*\}/g, '')
          isModified = true
        }

        // 3. Susun Ulang Struktur ESM yang Valid
        if (isModified) {
          // Unikkan baris import
          const uniqueImports = [...new Set(importLines)]
          
          // Bersihkan header path
          const fileName = path.basename(filePath, '.js')
          const folderCategory = path.basename(path.dirname(filePath))
          const header = '// plugins/' + folderCategory + '/' + fileName + '.js'

          let cleanBody = bodyText.replace(/^\/\/\s*plugins\/[^\n\r]+/g, '').trim()

          const newContent = [
            header,
            uniqueImports.join('\n'),
            '',
            cleanBody
          ].filter(Boolean).join('\n')

          try {
            fs.writeFileSync(filePath, newContent, 'utf8')
            cleanedCount++
          } catch (e) {
            failCount++
          }
        }
      }

      // Reload global plugins jika fungsi reloadGlobalPlugins tersedia
      try {
        const loadPluginsModule = path.join(rootDir, 'src', 'lib', 'loadPlugins.js')
        if (fs.existsSync(loadPluginsModule)) {
          const { reloadGlobalPlugins } = await import(pathToFileURL(loadPluginsModule).href + '?t=' + Date.now())
          if (typeof reloadGlobalPlugins === 'function') {
            await reloadGlobalPlugins()
          }
        }
      } catch (e) {
        // Ignored
      }

      if (m.react) await m.react('✅')
      
      let resText = '🧹 *PEMBERSIHAN STRUCTURAL AUTO-FIX SELESAI*\n\n'
      resText += '📂 *Total File Diperiksa:* ' + files.length + '\n'
      resText += '✨ *Berhasil Di-un-wrap & Diperbaiki:* ' + cleanedCount + '\n'
      resText += '❌ *Gagal:* ' + failCount + '\n\n'
      resText += '_Pernyataan `import` telah dipindahkan ke baris paling atas file. Silakan ketik `.addplugins` atau re-load bot._'

      await m.reply(resText)

    } catch (err) {
      console.error('[CLEANFIX ERROR]', err)
      if (m.react) await m.react('❌')
      await m.reply('❌ Terjadi kesalahan saat me-restore struktur file.')
    }
  }
}