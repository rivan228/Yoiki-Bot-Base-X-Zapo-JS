// plugins/owner/getplugin.js
import fs from 'fs';
import path from 'path';

/**
 * Mencari file plugin berdasarkan nama file, path, atau nama command
 */
function findPluginFile(query, pluginsRoot) {
  const cleanQuery = query.trim().replace(/^\./, '');
  const searchName = cleanQuery.endsWith('.js') ? cleanQuery : `${cleanQuery}.js`;

  // 1. Cek jika query berupa direct path (contoh: store/addproduk.js atau plugins/store/addproduk.js)
  const directPath = path.resolve(process.cwd(), cleanQuery.startsWith('plugins/') ? cleanQuery : path.join('plugins', cleanQuery));
  if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
    return directPath;
  }
  const directWithExt = `${directPath}.js`;
  if (fs.existsSync(directWithExt) && fs.statSync(directWithExt).isFile()) {
    return directWithExt;
  }

  // 2. Scan rekursif mencocokkan nama file atau deklarasi command di dalamnya
  let matchedByCommand = null;

  function traverse(dir) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const full = path.join(dir, item);
      if (fs.statSync(full).isDirectory()) {
        const res = traverse(full);
        if (res) return res;
      } else if (item.endsWith('.js')) {
        // Cocokkan nama file langsung
        if (item.toLowerCase() === searchName.toLowerCase()) {
          return full;
        }

        // Jika belum cocok nama file, periksa properti command di dalam file
        if (!matchedByCommand) {
          try {
            const code = fs.readFileSync(full, 'utf-8');
            const cmdRegex = new RegExp(`command\\s*:\\s*['"\`]${cleanQuery}['"\`]`, 'i');
            const aliasRegex = new RegExp(`alias\\s*:\\s*\\[[^\\]]*['"\`]${cleanQuery}['"\`][^\\]]*\\]`, 'i');
            if (cmdRegex.test(code) || aliasRegex.test(code)) {
              matchedByCommand = full;
            }
          } catch {}
        }
      }
    }
    return null;
  }

  const foundByName = traverse(pluginsRoot);
  return foundByName || matchedByCommand;
}

export default {
  command: 'getplugin',
  alias: ['gp', 'getp', 'getplugins'],
  category: 'owner',
  description: 'Mengambil isi script kode file plugin langsung dari server',
  onlyOwner: true,
  async execute(m, context) {
    const { args, sock } = context;

    if (!args[0]) {
      return await m.reply(
        `*CARA PENGGUNAAN .GETPLUGIN*\n\n` +
        `Ketik: \`.getplugin <nama_file / nama_command>\`\n\n` +
        `*Contoh:*\n` +
        `• \`.getplugin addproduk\` (Berdasarkan command)\n` +
        `• \`.getplugin backup.js\` (Berdasarkan nama file)\n` +
        `• \`.getplugin owner/cleartrash.js\` (Berdasarkan path)`
      );
    }

    const pluginsRoot = path.join(process.cwd(), 'plugins');
    if (!fs.existsSync(pluginsRoot)) {
      return await m.reply('❌ Folder `plugins/` tidak ditemukan di server.');
    }

    const targetFile = findPluginFile(args[0], pluginsRoot);

    if (!targetFile) {
      return await m.reply(`❌ Plugin dengan nama atau command \`${args[0]}\` tidak ditemukan di dalam folder \`plugins/\`.`);
    }

    try {
      const code = fs.readFileSync(targetFile, 'utf-8');
      const relPath = path.relative(process.cwd(), targetFile);

      // Kirim pesan teks kode (siap di-reply untuk .updateplugins)
      await m.reply(code);

      // Jika script sangat panjang (> 5000 karakter), kirimkan juga backup dokumen aslinya
      if (code.length > 5000) {
        await sock.message.send(m.chat, {
          document: Buffer.from(code, 'utf-8'),
          mimetype: 'application/javascript',
          fileName: path.basename(targetFile),
          caption: `📄 *File:* \`${relPath}\` (${(Buffer.byteLength(code) / 1024).toFixed(1)} KB)`
        }, { quoted: m });
      }
    } catch (err) {
      return await m.reply(`❌ Gagal membaca file plugin: ${err.message}`);
    }
  }
};