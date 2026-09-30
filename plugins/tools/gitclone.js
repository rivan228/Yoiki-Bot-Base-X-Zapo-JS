// plugins/tools/gitclone.js
import axios from 'axios';
import https from 'https';
import { performance } from 'perf_hooks';

const GITHUB_URL_REGEX = /(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9][\w-]{0,38})\/([a-zA-Z0-9._-]{1,100})(?:\.git)?/i;
const REPO_SHORTHAND_REGEX = /(?:^|\s)([a-zA-Z0-9][\w-]{0,38})\/([a-zA-Z0-9._-]{1,100})(?:\s|$)/i;

const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 20 });

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function extractRepo(raw) {
  if (!raw) return null;
  const text = raw.trim();
  const fromUrl = text.match(GITHUB_URL_REGEX);
  if (fromUrl) return { user: fromUrl[1], repo: fromUrl[2].replace(/\.git$/i, '') };
  const fromShorthand = text.match(REPO_SHORTHAND_REGEX);
  if (fromShorthand) return { user: fromShorthand, repo: fromShorthand.replace(/\.git$/i, '') };
  return null;
}[1][2]

export default {
  command: 'gitclone',
  alias: ['git', 'clonegit'],
  category: 'tools',
  description: 'Download repo GitHub jadi file ZIP',
  help: '<url atau user/repo>',
  onlyOwner: false,

  async execute(m, { sock, args }) {
    const input = (args.join(' ') || m.quoted?.text || '').trim();
    if (!input) {
      return await sock.message.send(m.chat, {
        text: `Masukkan repo GitHub!\nContoh:\n•.gitclone nazedev/hitori\n•.gitclone https://github.com/nazedev/hitori\n• Reply pesan yang ada link GitHub lalu.gitclone`
      }, { quoted: m });
    }

    const target = extractRepo(input);
    if (!target) {
      return await sock.message.send(m.chat, { text: '❌ Format salah. Pakai `user/repo` atau link GitHub' }, { quoted: m });
    }

    const { user, repo } = target;
    const zipUrl = `https://api.github.com/repos/${user}/${repo}/zipball`;
    const repoUrl = `https://github.com/${user}/${repo}`;
    const t0 = performance.now();

    try {
      await sock.message.react(m.chat, m.key, '⏳');

      // Download pakai arraybuffer biar Zapo-JS bisa kirim
      const response = await axios.get(zipUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/vnd.github+json'
        },
        httpsAgent: keepAliveAgent,
        responseType: 'arraybuffer',
        timeout: 90000,
        maxRedirects: 10
      });

      const buffer = Buffer.from(response.data);
      if (!buffer.length) throw new Error('File kosong');

      const size = formatBytes(buffer.length);
      const caption = `📦 *Repo:* ${user}/${repo}\n🔗 *Link:* ${repoUrl}\n📄 *Ukuran:* ${size}`;

      await sock.message.send(m.chat, {
        type: 'document',
        media: buffer,
        mimetype: 'application/zip',
        fileName: `${repo}.zip`,
        caption
      }, { quoted: m });

      await sock.message.react(m.chat, m.key, '✅');
      console.log(`[GITCLONE] ${user}/${repo} selesai ${(performance.now() - t0) / 1000}s`);

    } catch (err) {
      const status = err.response?.status;
      const msg = status === 404
       ? `❌ Repo *${user}/${repo}* tidak ditemukan atau private`
        : `❌ Gagal download!\n*Status:* ${status || 'Error'}\n*Pesan:* ${err.message}`;
      await sock.message.react(m.chat, m.key, '❌');
      await sock.message.send(m.chat, { text: msg }, { quoted: m });
    }
  }
};