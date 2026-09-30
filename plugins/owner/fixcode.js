// plugins/owner/cekerror.js
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';

const CONFIG_PATH = path.join(process.cwd(), 'database_gemini.json');

/**
 * Menyimpan / Mengambil Gemini API Key
 */
function getApiKey() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      return data.apiKey || null;
    } catch {}
  }
  return null;
}

function saveApiKey(key) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ apiKey: key }, null, 2), 'utf-8');
}

/**
 * Validasi Sintaks Nyata menggunakan Node.js V8 Compiler (--check)
 */
function runNodeSyntaxCheck(code) {
  const tmpName = `lint_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.mjs`;
  const tmpPath = path.join(os.tmpdir(), tmpName);

  try {
    fs.writeFileSync(tmpPath, code, 'utf-8');
    const result = spawnSync(process.execPath, ['--check', tmpPath], {
      encoding: 'utf-8',
      timeout: 5000
    });

    if (result.status === 0) {
      return { valid: true, error: null };
    }

    const stderr = result.stderr || result.stdout || '';
    const lines = stderr.split('\n');
    let message = 'SyntaxError tidak dikenal';
    for (const l of lines) {
      if (l.includes('SyntaxError:') || l.includes('ReferenceError:') || l.includes('TypeError:')) {
        message = l.trim();
        break;
      }
    }

    const lineMatch = stderr.match(/lint_.*?\.mjs:(\d+)/);
    const lineNum = lineMatch ? parseInt(lineMatch[1], 10) : null;

    return {
      valid: false,
      line: lineNum,
      message,
      raw: stderr.replace(new RegExp(tmpPath, 'g'), 'code.js').trim()
    };
  } catch (err) {
    return { valid: false, line: null, message: err.message, raw: err.message };
  } finally {
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }
}

/**
 * Panggil Google AI Studio (Gemini 2.5 Flash / 2.0 Flash) untuk memperbaiki kode
 */
async function askGeminiToFix(brokenCode, filePath = '', compilerError = '') {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('API Key Gemini belum disetting! Ketik: `.cekerror setkey <API_KEY>`');
  }

  const prompt = `Anda adalah Senior JavaScript Engine Specialist untuk bot WhatsApp Zapo-JS (ESM).
Tugas Anda adalah MEMPERBAIKI KODE BERIKUT HINGGA 100% BEBAS ERROR dan lolos uji Node.js (\`node --check\`).

DETAIL MASALAH DARI COMPILER NODE.JS:
${compilerError || 'Syntax error / broken code'}

ATURAN WAJIB SUMBER KODE:
1. Baris pertama WAJIB ada komentar path file: ${filePath ? `// ${filePath}` : '// plugins/tools/fixed_plugin.js'}
2. Gunakan sintaks ESM: export default { command, alias, category, description, onlyOwner, async execute(m, context) { ... } }
3. Gunakan context: const { sock, args, plugins } = context;
4. Gunakan m.reply(...) atau sock.message.send(m.chat, ...) (JANGAN GUNAKAN sock.sendMessage).
5. Lengkapi kode yang terpotong, perbaiki kurung/kurawal/tanda kutip, perbaiki logika fungsi agar valid.
6. OUTPUT HANYA KODE JAVASCRIPT MURNI. Jangan beri pengantar, penjelasan, atau teks apapun di luar blok kode.

KODE YANG RUSAK:
${brokenCode}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google AI Studio Error (${response.status}): ${errText}`);
  }

  const json = await response.json();
  let resultText = json.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Bersihkan markdown blok ```javascript jika ada
  resultText = resultText
    .replace(/^```(?:javascript|js)?\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim();

  return resultText;
}

/**
 * Scan seluruh file .js di direktori
 */
function scanPluginsDir(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      scanPluginsDir(fullPath, fileList);
    } else if (file.endsWith('.js')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

export default {
  command: 'cekerror',
  alias: ['cekerr', 'fixcode', 'fixplugins', 'autofix'],
  category: 'owner',
  description: 'Mendeteksi dan memperbaiki semua error kode menggunakan Gemini AI & V8 Compiler',
  onlyOwner: true,
  async execute(m, context) {
    const { args } = context;

    // 1. Fitur Set API Key Gemini
    if (args[0] === 'setkey') {
      const key = args[1]?.trim();
      if (!key) {
        return await m.reply('❌ Masukkan API key! Contoh:\n`.cekerror setkey AIzaSyDxxxxxxxxxxxx`');
      }
      saveApiKey(key);
      return await m.reply('✅ *API Key Google Gemini Studio berhasil disimpan!*\nSekarang kamu bisa jalankan `.cekerror all --fix`.');
    }

    const apiKey = getApiKey();
    const isScanAll = args[0] === 'all' || args[0] === 'scan';
    const isAutoFixAll = args.includes('--fix');
    const cleanArgs = args.filter(a => a !== '--fix' && a !== '--save');

    // ==========================================
    // MODE 1: GLOBAL AUTO-SCAN SEMUA PLUGINS
    // ==========================================
    if (isScanAll) {
      await m.reply('🔍 *Memeriksa seluruh file di folder `plugins/` dengan Node.js Compiler...*');
      const pluginsDir = path.join(process.cwd(), 'plugins');
      const allFiles = scanPluginsDir(pluginsDir);

      if (allFiles.length === 0) {
        return await m.reply('❌ Folder `plugins/` tidak ditemukan atau kosong.');
      }

      const brokenFiles = [];

      for (const filePath of allFiles) {
        const relativePath = path.relative(process.cwd(), filePath);
        const code = fs.readFileSync(filePath, 'utf-8');
        const check = runNodeSyntaxCheck(code);

        if (!check.valid || !code.includes('export default') || !code.includes('command:')) {
          brokenFiles.push({
            filePath,
            relativePath,
            error: check.message || 'Format struktur plugin tidak valid',
            line: check.line,
            code
          });
        }
      }

      if (brokenFiles.length === 0) {
        return await m.reply(`✅ *SEMUA PLUGINS SEHAT!*\nBerhasil memeriksa *${allFiles.length}* file. Semuanya lolos validasi compiler.`);
      }

      // Jika ada flag --fix: Jalankan Perbaikan dengan AI
      if (isAutoFixAll) {
        if (!apiKey) {
          return await m.reply(
            `❌ *Ditemukan ${brokenFiles.length} file error!*\n\n` +
            `Untuk memperbaiki seluruh file secara akurat sampai 100%, bot membutuhkan Gemini AI.\n` +
            `Silakan set API Key terlebih dahulu:\n` +
            `└ \`.cekerror setkey <APIKEY_GOOGLE_AI_STUDIO>\``
          );
        }

        await m.reply(`🤖 *Gemini AI sedang memperbaiki ${brokenFiles.length} file yang error satu per satu... Mohon tunggu.*`);

        let fixedCount = 0;
        let report = `🛠️ *LAPORAN PERBAIKAN AI GEMINI:*\n\n`;

        for (const item of brokenFiles) {
          try {
            const aiFixedCode = await askGeminiToFix(item.code, item.relativePath, item.error);
            const verify = runNodeSyntaxCheck(aiFixedCode);

            if (verify.valid) {
              fs.writeFileSync(item.filePath, aiFixedCode, 'utf-8');
              fixedCount++;
              report += `✅ *${item.relativePath}* -> BERHASIL DIPERBAIKI (100% Valid)\n`;
            } else {
              report += `⚠️ *${item.relativePath}* -> Gagal verifikasi compiler: ${verify.message}\n`;
            }
          } catch (err) {
            report += `❌ *${item.relativePath}* -> Error API: ${err.message}\n`;
          }
        }

        report += `\n🎉 *Hasil Akhir:* Berhasil memperbaiki *${fixedCount}/${brokenFiles.length}* file!`;
        return await m.reply(report);
      }

      // Tampilkan list error jika tanpa flag --fix
      let scanResult = `🚨 *DITEMUKAN ${brokenFiles.length} FILE RUSAK/ERROR:*\n\n`;
      brokenFiles.forEach((item, idx) => {
        const lineText = item.line ? `[Baris ${item.line}] ` : '';
        scanResult += `*${idx + 1}. ${item.relativePath}*\n   └ ❌ ${lineText}${item.error}\n`;
      });

      scanResult += `\n💡 *Perbaiki semua file di atas dengan AI:*\nKetik:\n\`.cekerror all --fix\``;
      return await m.reply(scanResult.trim());
    }

    // ==========================================
    // MODE 2: CEK KODE SPESIFIK / REPLY KODE
    // ==========================================
    let targetCode = '';
    let targetFilePath = null;
    let autoSave = args.includes('--fix') || args.includes('--save');

    if (m.quoted && m.quoted.text) {
      targetCode = m.quoted.text;
    } else if (cleanArgs.length > 0) {
      const resolved = path.resolve(process.cwd(), cleanArgs[0]);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        targetFilePath = resolved;
        targetCode = fs.readFileSync(resolved, 'utf-8');
      } else {
        targetCode = cleanArgs.join(' ');
      }
    }

    if (!targetCode.trim()) {
      return await m.reply(
        `*CARA MENGGUNAKAN AI CODE FIXER:*\n\n` +
        `1. *Setting API Key Gemini:*\n` +
        `   └ \`.cekerror setkey AIzaSyXXXXX\`\n\n` +
        `2. *Perbaiki Semua File Rusak Sekaligus:*\n` +
        `   └ \`.cekerror all --fix\`\n\n` +
        `3. *Perbaiki File Tertentu:*\n` +
        `   └ \`.cekerror plugins/tools/menu.js --fix\`\n\n` +
        `4. *Perbaiki Pesan Kode (Reply):*\n` +
        `   └ Reply kode yang error lalu ketik: \`.cekerror\``
      );
    }

    const relPath = targetFilePath ? path.relative(process.cwd(), targetFilePath) : '';
    const initialCheck = runNodeSyntaxCheck(targetCode);

    if (initialCheck.valid && targetCode.includes('export default')) {
      return await m.reply('✅ *KODE VALID:* Kode ini sudah lolos uji compiler Node.js dan tidak memiliki error sintaks.');
    }

    await m.reply(
      `🔍 *Error terdeteksi:* ${initialCheck.message || 'Format tidak sesuai'}\n` +
      `🤖 *Menghubungi Gemini AI Studio untuk memperbaiki kode...*`
    );

    try {
      const aiFixedCode = await askGeminiToFix(targetCode, relPath, initialCheck.raw);
      const verify = runNodeSyntaxCheck(aiFixedCode);

      if (!verify.valid) {
        return await m.reply(
          `⚠️ *AI menghasilkan kode namun masih ada kesalahan sintaks:*\n\`\`\`\n${verify.raw}\n\`\`\`\n\n` +
          `Kode yang dihasilkan:\n\`\`\`javascript\n${aiFixedCode}\n\`\`\``
        );
      }

      let responseMsg = `✨ *BERHASIL DIPERBAIKI OLEH GEMINI AI (100% VALID & LOLOS NODE.JS)*\n\n`;

      if (targetFilePath && autoSave) {
        fs.writeFileSync(targetFilePath, aiFixedCode, 'utf-8');
        responseMsg += `💾 File *${relPath}* telah otomatis diperbarui di server!`;
      } else {
        responseMsg += `*Kode Perbaikan Siap Pakai:*\n\`\`\`javascript\n${aiFixedCode}\n\`\`\``;
        if (targetFilePath) {
          responseMsg += `\n\n💡 Ketik \`.cekerror ${cleanArgs[0]} --fix\` untuk langsung menimpa file.`;
        }
      }

      return await m.reply(responseMsg);
    } catch (err) {
      if (err.message.includes('fetch failed') || err.message.includes('ENOTFOUND')) {
        return await m.reply(
          `❌ *Gagal Menghubungi API Gemini!*\n\n` +
          `Penyebab: Server Pterodactyl Anda memblokir outgoing request (DNS Error). Hubungi penyedia hosting untuk membuka akses internet/DNS port 443.`
        );
      }
      return await m.reply(`❌ *Terjadi Kesalahan:* ${err.message}`);
    }
  }
};