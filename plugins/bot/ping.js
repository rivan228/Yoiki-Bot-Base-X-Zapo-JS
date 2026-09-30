// plugins/bot/ping.js
import os from 'os';

/**
 * Format bytes ke MB / GB
 */
function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

/**
 * Format detik ke format waktu bahasa Indonesia
 */
function formatUptime(seconds) {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const res = [];
  if (d > 0) res.push(`${d}h`);
  if (h > 0) res.push(`${h}j`);
  if (m > 0) res.push(`${m}m`);
  res.push(`${s}d`);
  return res.join(' ');
}

/**
 * Visual Progress Bar Modern (▰▱)
 */
function createBar(percent, length = 8) {
  const safe = Math.min(100, Math.max(0, parseFloat(percent) || 0));
  const filled = Math.round((safe / 100) * length);
  const empty = Math.max(0, length - filled);
  return '▰'.repeat(filled) + '▱'.repeat(empty);
}

export default {
  command: 'ping',
  alias: ['p', 'speed', 'status', 'botstatus'],
  category: 'bot',
  description: 'Cek kecepatan respon, performa sistem, dan status server bot',
  onlyOwner: false,
  async execute(m, context) {
    const { sock } = context;

    try {
      const startTime = Date.now();

      // 1. Latensi WA & Device Jitter
      let ping = 0;
      if (m.messageTimestamp) {
        const raw = typeof m.messageTimestamp === 'object'
          ? (m.messageTimestamp.low || m.messageTimestamp)
          : m.messageTimestamp;
        const msgTime = raw > 1e11 ? raw : raw * 1000;
        ping = Math.max(0, Date.now() - msgTime);
      }
      if (ping <= 0 || ping > 60000) ping = Date.now() - startTime;

      // 2. Resource Memory Node.js & Host Container
      const mem = process.memoryUsage();
      const totalMem = os.totalmem();
      const usedMem = mem.rss;
      const ramPercent = totalMem > 0 ? ((usedMem / totalMem) * 100).toFixed(1) : '0';
      const heapPercent = mem.heapTotal > 0 ? ((mem.heapUsed / mem.heapTotal) * 100).toFixed(1) : '0';

      // 3. CPU Metrics
      const cpus = os.cpus() || [];
      const cpuModel = cpus[0]?.model ? cpus[0].model.replace(/\s+/g, ' ').trim() : 'Pterodactyl Container';
      const cpuCores = cpus.length || 1;
      const load = (os.loadavg && os.loadavg()[0]) || 0;
      const cpuPercent = Math.min(100, Math.max(0, (load / cpuCores) * 100)).toFixed(1);

      // 4. Kategori Kecepatan
      let speedBadge = '⚡ ULTRA FAST';
      if (ping > 300) speedBadge = '🐢 SLOW';
      else if (ping > 150) speedBadge = '🚀 OPTIMAL';

      // 5. Susun Desain Tampilan Baru (Cyber Minimalist)
      const teks = 
`╭───〔 ⚡ ＳＰＥＥＤ  ＴＥＳＴ 〕───╮
│
│ 📡 *Respon:* ${ping} ms  •  [${speedBadge}]
│ ⏱️ *Aktif:* ${formatUptime(process.uptime())}
│
├──────────────────────────
│ 📊 *ＳＹＳＴＥＭ  ＭＥＴＲＩＣＳ*
│
│ ⚙️ *CPU:* \`[${createBar(cpuPercent)}]\` ${cpuPercent}%
│   └ ${cpuCores} Core • ${cpuModel.slice(0, 22)}
│
│ 💾 *RAM:* \`[${createBar(ramPercent)}]\` ${ramPercent}%
│   └ ${formatBytes(usedMem)} / ${formatBytes(totalMem)}
│
│ 🧠 *V8 Heap:* \`[${createBar(heapPercent)}]\` ${heapPercent}%
│   └ Digunakan: ${formatBytes(mem.heapUsed)}
│
├──────────────────────────
│ 🖥️ *ＥＮＶＩＲＯＮＭＥＮＴ*
│
│ • *Platform:* Linux ${os.arch()} (Pterodactyl)
│ • *Engine:* Node.js ${process.version} (ESM)
│ • *Host Core:* Zapo-JS Architecture
│
╰──────────────────────────╯`.trim();

      // Gunakan m.reply default (terbukti stabil & tidak akan silent crash)
      return await m.reply(teks);
    } catch (err) {
      // Fallback cadangan jika m.reply mengalami kendala
      try {
        return await sock.message.send(m.chat, { text: `❌ Ping Gagal: ${err.message}` }, { quoted: m });
      } catch {}
    }
  }
};