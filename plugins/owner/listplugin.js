// plugins/owner/listplugin.js
import fs from 'fs';
import path from 'path';

/**
 * Format ukuran file ke B, KB, MB
 */
function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default {
  command: 'listplugin',
  alias: ['listplugins', 'lp', 'pluginslist'],
  category: 'owner',
  description: 'Melihat daftar lengkap seluruh file plugin aktif di server bot',
  onlyOwner: true,
  async execute(m, context) {
    const { args } = context;
    const pluginsRoot = path.join(process.cwd(), 'plugins');

    if (!fs.existsSync(pluginsRoot)) {
      return await m.reply('❌ Direktori `plugins/` tidak ditemukan di server.');
    }

    // Ambil semua kategori folder
    const categories = fs.readdirSync(pluginsRoot).filter(item => {
      const full = path.join(pluginsRoot, item);
      return fs.statSync(full).isDirectory();
    });

    if (categories.length === 0) {
      return await m.reply('❌ Tidak ada folder kategori di dalam `plugins/`.');
    }

    const filterCategory = args[0] ? args[0].toLowerCase() : null;
    let totalFiles = 0;
    let totalSizeBytes = 0;
    const resultCategories = [];

    for (const cat of categories) {
      if (filterCategory && cat.toLowerCase() !== filterCategory) continue;

      const catPath = path.join(pluginsRoot, cat);
      const files = fs.readdirSync(catPath).filter(f => f.endsWith('.js'));

      const fileDetails = [];
      for (const file of files) {
        const filePath = path.join(catPath, file);
        const stats = fs.statSync(filePath);
        totalFiles++;
        totalSizeBytes += stats.size;

        // Ekstrak nama command dari file jika ada
        let cmdName = file.replace('.js', '');
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const match = content.match(/command\s*:\s*['"`]([a-zA-Z0-9_-]+)['"`]/);
          if (match && match[1]) {
            cmdName = match[1];
          }
        } catch {}

        fileDetails.push({
          fileName: file,
          command: cmdName,
          size: stats.size
        });
      }

      if (fileDetails.length > 0 || filterCategory) {
        resultCategories.push({
          category: cat,
          files: fileDetails
        });
      }
    }

    if (resultCategories.length === 0) {
      return await m.reply(`❌ Kategori \`${args[0]}\` tidak ditemukan. Kategori yang tersedia: ${categories.join(', ')}`);
    }

    // Susun Tampilan
    let txt = `📦 *DAFTAR FILE PLUGIN SERVER BOT*\n`;
    txt += `• Total Plugin: *${totalFiles} File*\n`;
    txt += `• Total Kapasitas: *${formatSize(totalSizeBytes)}*\n`;
    txt += `• Waktu Scan: *${new Date().toLocaleTimeString('id-ID')} WIB*\n`;
    txt += `─────────────────────────\n\n`;

    for (const group of resultCategories) {
      txt += `📂 *Kategori: ${group.category.toUpperCase()}* (${group.files.length} file)\n`;
      group.files.forEach((f, idx) => {
        txt += `  ${idx + 1}. \`${f.fileName}\` (Cmd: \`.${f.command}\`) [${formatSize(f.size)}]\n`;
      });
      txt += `\n`;
    }

    txt += `─────────────────────────\n`;
    txt += `💡 *Tips:* Ketik \`.getplugin <nama_file/command>\` untuk mengambil kode file tersebut.`;

    return await m.reply(txt.trim());
  }
};