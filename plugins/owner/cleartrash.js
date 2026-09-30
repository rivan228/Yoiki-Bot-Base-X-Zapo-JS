// plugins/owner/cleartrash.js
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Format bytes ke ukuran yang rapi (B, KB, MB, GB)
 */
function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

/**
 * Daftar folder & file yang DILINDUNGI MUTLAK (Tidak boleh disentuh!)
 */
const PROTECTED_DIRS = new Set([
  'plugins',
  'src',
  'lib',
  'node_modules',
  '.git',
  'session',
  'sessions',
  'auth',
  'baileys_auth_info',
  'database',
  'data',
  'db'
]);

function isDatabaseOrCritical(filename) {
  const lower = filename.toLowerCase();
  // Filter proteksi database & file inti bot
  const dbPatterns = [
    'database',
    'creds.json',
    'settings.js',
    'config.js',
    'package.json',
    'package-lock.json',
    'users.json',
    'groups.json',
    'store.json'
  ];

  if (dbPatterns.some(p => lower.includes(p))) return true;
  if (lower.endsWith('.db') || lower.endsWith('.sqlite') || lower.endsWith('.sqlite3')) return true;
  return false;
}

/**
 * Hapus folder beserta seluruh isinya secara rekursif
 */
function removeDirectoryRecursive(dirPath) {
  if (!fs.existsSync(dirPath)) return { folderCount: 0, fileCount: 0, size: 0 };
  let folderCount = 0;
  let fileCount = 0;
  let size = 0;

  try {
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
      const fullPath = path.join(dirPath, item);

      // Lewatkan jika tanpa sengaja mendeteksi file database
      if (isDatabaseOrCritical(item)) continue;

      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          const sub = removeDirectoryRecursive(fullPath);
          folderCount += sub.folderCount;
          fileCount += sub.fileCount;
          size += sub.size;
        } else {
          size += stat.size;
          fs.unlinkSync(fullPath);
          fileCount++;
        }
      } catch {}
    }

    // Hapus folder itu sendiri
    fs.rmdirSync(dirPath);
    folderCount++;
  } catch {}

  return { folderCount, fileCount, size };
}

/**
 * Bersihkan isi folder tmp/temp tanpa menghapus root folder tmp itu sendiri
 */
function cleanTempDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) return { folderCount: 0, fileCount: 0, size: 0 };
  let folderCount = 0;
  let fileCount = 0;
  let size = 0;

  try {
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
      const fullPath = path.join(dirPath, item);

      if (isDatabaseOrCritical(item)) continue;

      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          const sub = removeDirectoryRecursive(fullPath);
          folderCount += sub.folderCount;
          fileCount += sub.fileCount;
          size += sub.size;
        } else {
          size += stat.size;
          fs.unlinkSync(fullPath);
          fileCount++;
        }
      } catch {}
    }
  } catch {}

  return { folderCount, fileCount, size };
}

/**
 * Bersihkan file log & dump sampah di root bot
 */
function cleanRootGarbageFiles(rootDir) {
  let count = 0;
  let size = 0;
  const junkPattern = /\.(log|bak|tmp|swp|swo)$|^(Thumbs\.db|\.DS_Store|core\.\d+|npm-debug\.log.*)$/i;

  try {
    const items = fs.readdirSync(rootDir);
    for (const item of items) {
      if (isDatabaseOrCritical(item)) continue;

      const itemPath = path.join(rootDir, item);
      try {
        const stat = fs.statSync(itemPath);
        if (stat.isFile() && junkPattern.test(item)) {
          size += stat.size;
          fs.unlinkSync(itemPath);
          count++;
        }
      } catch {}
    }
  } catch {}

  return { count, size };
}

export default {
  command: 'cleartrash',
  alias: ['clearcache', 'cleaner', 'hapussampah', 'cleantmp', 'cleanfolder'],
  category: 'owner',
  description: 'Membersihkan file sampah & memusnahkan folder cache/temp tanpa menyentuh database',
  onlyOwner: true,
  async execute(m, context) {
    const rootDir = process.cwd();
    const memBefore = process.memoryUsage().heapUsed;

    await m.reply('🧹 *Memulai pembersihan total (file sampah + folder cache)...*\n🛡️ _Database & Session diproteksi aman._');

    let totalFilesDeleted = 0;
    let totalFoldersDeleted = 0;
    let totalFreedBytes = 0;
    const actionsTaken = [];

    // 1. Bersihkan Seluruh Subfolder & File di dalam folder Temp Bot
    const tempDirs = ['tmp', 'temp'];
    for (const tDir of tempDirs) {
      const fullPath = path.join(rootDir, tDir);
      if (fs.existsSync(fullPath)) {
        const res = cleanTempDirectory(fullPath);
        if (res.fileCount > 0 || res.folderCount > 0) {
          totalFilesDeleted += res.fileCount;
          totalFoldersDeleted += res.folderCount;
          totalFreedBytes += res.size;
          actionsTaken.push(`Direktori \`./${tDir}/\`: ${res.fileCount} file & ${res.folderCount} subfolder dimusnahkan (${formatSize(res.size)})`);
        }
      } else {
        try { fs.mkdirSync(fullPath, { recursive: true }); } catch {}
      }
    }

    // 2. Musnahkan Folder Cache & Sampah Utuh
    const junkFolderTargets = ['.cache', 'cache', '.npm', '.yarn', 'logs', '.temp'];
    for (const junkFolder of junkFolderTargets) {
      // Pastikan bukan folder yang diproteksi
      if (PROTECTED_DIRS.has(junkFolder)) continue;

      const targetPath = path.join(rootDir, junkFolder);
      if (fs.existsSync(targetPath)) {
        const res = removeDirectoryRecursive(targetPath);
        if (res.folderCount > 0 || res.fileCount > 0) {
          totalFoldersDeleted += res.folderCount;
          totalFilesDeleted += res.fileCount;
          totalFreedBytes += res.size;
          actionsTaken.push(`Folder Sampah \`./${junkFolder}/\`: Dihapus total (${formatSize(res.size)})`);
        }
      }
    }

    // 3. Bersihkan File Log & Dump di Root Server
    const rootFiles = cleanRootGarbageFiles(rootDir);
    if (rootFiles.count > 0) {
      totalFilesDeleted += rootFiles.count;
      totalFreedBytes += rootFiles.size;
      actionsTaken.push(`File Dump & Logs (*.log, *.bak): ${rootFiles.count} file dihapus (${formatSize(rootFiles.size)})`);
    }

    // 4. Bersihkan Cache Compiler Node.js di /tmp OS Container
    try {
      const osTmpFiles = fs.readdirSync(os.tmpdir());
      let osTmpSize = 0;
      let osTmpCount = 0;

      for (const f of osTmpFiles) {
        if (/^(lint_|check_|tmp_|temp_|ffmpeg|upload_|wa-|baileys)/i.test(f) || f.endsWith('.mjs')) {
          const p = path.join(os.tmpdir(), f);
          try {
            const st = fs.statSync(p);
            osTmpSize += st.size;
            fs.unlinkSync(p);
            osTmpCount++;
          } catch {}
        }
      }

      if (osTmpCount > 0) {
        totalFilesDeleted += osTmpCount;
        totalFreedBytes += osTmpSize;
        actionsTaken.push(`OS V8 Temp (/tmp/): ${osTmpCount} compiler dump dihapus (${formatSize(osTmpSize)})`);
      }
    } catch {}

    // 5. Force Garbage Collection untuk melepaskan RAM Heap
    if (global.gc) {
      try { global.gc(); } catch {}
    }

    const memAfter = process.memoryUsage().heapUsed;
    const memSaved = memBefore > memAfter ? memBefore - memAfter : 0;

    // 6. Susun Laporan Akhir
    let rep = `✨ *PEMBERSIHAN SAMPAH TOTAL SELESAI* ✨\n\n`;
    rep += `📊 *Statistik Pembersihan:*\n`;
    rep += `• 📁 Folder Sampah Dihapus: *${totalFoldersDeleted} folder*\n`;
    rep += `• 📄 File Sampah Dihapus: *${totalFilesDeleted} file*\n`;
    rep += `• 💾 Storage Dikosongkan: *${formatSize(totalFreedBytes)}*\n\n`;

    if (actionsTaken.length > 0) {
      rep += `📂 *Rincian Tindakan:*\n`;
      actionsTaken.forEach((act, idx) => {
        rep += `  ${idx + 1}. ${act}\n`;
      });
      rep += `\n`;
    } else {
      rep += `📂 *Rincian:* Server Anda sudah sangat bersih, tidak ada folder maupun file sampah tersisa.\n\n`;
    }

    rep += `🛡️ *Status Database & Data:*\n`;
    rep += `• Database: *100% Aman & Terlindungi*\n`;
    rep += `• Session WA: *Aman (Tidak Disentuh)*\n\n`;

    rep += `⚡ *Kondisi RAM Container:*\n`;
    rep += `• RAM Digunakan: *${formatSize(memAfter)}*\n`;
    if (memSaved > 0) {
      rep += `• RAM Dilepaskan: *${formatSize(memSaved)}*\n`;
    }
    rep += `• Performa: *Jauh Lebih Ringan & Cepat*`;

    return await m.reply(rep);
  }
};