// plugins/tools/tempmail.js

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';
import * as cheerio from 'cheerio';

// ==========================================
// KONFIGURASI STORAGE & PROVIDER ENGINE
// ==========================================
const STORAGE_DIR = path.join(process.cwd(), 'storage', 'tempmail');
const SESSIONS_FILE = path.join(STORAGE_DIR, 'sessions.json');

const GENERATOR_BASE_URL = 'https://generator.email/';
const TEMPMAIL_CHAT_PRIMARY_API = 'https://tempmail-backend.hasnaintariq142.workers.dev';
const TEMPMAIL_CHAT_FALLBACK_API = 'https://tempmail.chat';

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
};

const FALLBACK_DOMAINS = [
  'dailynutria.com', 'mkda9884.top', 'thuha99.com', 'cuaks.fun',
  'xx-p1.top', 'lunarmoon.online', 'regvippro.site', 'icloudemail.kr',
  'syaacantik.me', 'hiverun.io', 'spotiy.site', 'mevuba.tech'
];

// ==========================================
// SESSION MANAGER PER USER (WHATSAPP JID)
// ==========================================
function getSessionMap() {
  try {
    if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
    if (fs.existsSync(SESSIONS_FILE)) {
      return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    }
  } catch (_) {}
  return {};
}

function saveUserSession(senderJid, sessionData) {
  try {
    const map = getSessionMap();
    if (sessionData === null) {
      delete map[senderJid];
    } else {
      map[senderJid] = {
        ...sessionData,
        updatedAt: new Date().toISOString()
      };
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(map, null, 2), 'utf8');
  } catch (_) {}
}

function getUserSession(senderJid) {
  const map = getSessionMap();
  return map[senderJid] || null;
}

// ==========================================
// ENGINE NATIVE TEMP MAIL CLIENT
// ==========================================
class UniversalTempMail {
  static async fetchGeneratorDomain() {
    try {
      const res = await axios.get(GENERATOR_BASE_URL, {
        headers: DEFAULT_HEADERS,
        timeout: 6000
      });
      const $ = cheerio.load(res.data);
      const token = $('meta[name="api-token"]').attr('content');
      const cookies = (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');

      if (token) {
        const domRes = await axios.get('https://generator.email/api/domains.php', {
          headers: {
            'X-API-Token': token,
            'X-Requested-With': 'XMLHttpRequest',
            'Cookie': cookies,
            ...DEFAULT_HEADERS
          },
          timeout: 5000
        });
        if (Array.isArray(domRes.data) && domRes.data.length > 0) {
          const list = domRes.data
            .map((d) => (d.display || d.ascii || d).toLowerCase().trim())
            .filter((d) => d && d.includes('.') && !d.includes('generator.email'));
          if (list.length > 0) return list[Math.floor(Math.random() * list.length)];
        }
      }

      const dom = $('#domainName2').val();
      if (dom && dom.includes('.') && !dom.includes('generator.email')) {
        return dom.toLowerCase().trim();
      }
    } catch (_) {}
    return FALLBACK_DOMAINS[Math.floor(Math.random() * FALLBACK_DOMAINS.length)];
  }

  // 1. TempMail.chat (Cloudflare Workers API)
  static async createTempMailChat() {
    const endpoints = [
      `${TEMPMAIL_CHAT_PRIMARY_API}/api/create-inbox`,
      `${TEMPMAIL_CHAT_FALLBACK_API}/api/create-inbox`
    ];

    let data = null;
    let lastErr = null;

    for (const ep of endpoints) {
      try {
        const res = await axios.post(ep, {}, {
          headers: {
            ...DEFAULT_HEADERS,
            'Content-Type': 'application/json',
            'Origin': 'https://tempmail.chat',
            'Referer': 'https://tempmail.chat/'
          },
          timeout: 10000
        });
        if (res.data?.success && res.data?.email) {
          data = res.data;
          break;
        }
      } catch (err) {
        lastErr = err;
      }
    }

    if (!data) throw new Error(`TempMail.chat error: ${lastErr?.message || 'Gagal koneksi'}`);

    return {
      email: data.email,
      token: data.access_token || data.token,
      provider: 'tempmail-chat',
      expiresIn: data.expires_in || 86400,
      createdAt: new Date().toISOString()
    };
  }

  static async getInboxTempMailChat(token) {
    const endpoints = [
      `${TEMPMAIL_CHAT_PRIMARY_API}/api/inbox?token=${encodeURIComponent(token)}`,
      `${TEMPMAIL_CHAT_FALLBACK_API}/api/inbox?token=${encodeURIComponent(token)}`
    ];

    let data = null;
    for (const ep of endpoints) {
      try {
        const res = await axios.get(ep, {
          headers: {
            ...DEFAULT_HEADERS,
            'Origin': 'https://tempmail.chat',
            'Referer': 'https://tempmail.chat/'
          },
          timeout: 10000
        });
        if (res.data?.success || Array.isArray(res.data?.messages)) {
          data = res.data;
          break;
        }
      } catch (_) {}
    }

    if (!data) return [];
    const list = data.messages || [];
    return list.map((m) => ({
      id: String(m.id || ''),
      from: m.sender_name && m.sender_email ? `${m.sender_name} <${m.sender_email}>` : (m.sender_email || m.sender_name || 'Unknown'),
      subject: m.subject || '(Tanpa Subjek)',
      date: m.received_at || new Date().toISOString(),
      text: m.body_text || '',
      html: m.body_html || ''
    }));
  }

  // 2. Mail.tm REST API
  static async createMailTm(customPrefix = '') {
    const domainRes = await axios.get('https://api.mail.tm/domains?page=1', { timeout: 10000 });
    const domain = domainRes.data?.['hydra:member']?.[0]?.domain;
    if (!domain) throw new Error('Domain Mail.tm sedang tidak tersedia.');

    const randNum = Math.floor(100000 + Math.random() * 900000);
    const prefix = (customPrefix || `user_${randNum}`).replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 16);
    let address = `${prefix}_${Date.now().toString().slice(-4)}@${domain}`.toLowerCase();
    const password = `Pass#${crypto.randomBytes(4).toString('hex')}1!`;

    try {
      await axios.post('https://api.mail.tm/accounts', { address, password }, { timeout: 10000 });
    } catch (err) {
      if (err.response?.status === 422) {
        address = `user${randNum}_${Date.now().toString().slice(-4)}@${domain}`;
        await axios.post('https://api.mail.tm/accounts', { address, password }, { timeout: 10000 });
      } else {
        throw err;
      }
    }

    const tokenRes = await axios.post('https://api.mail.tm/token', { address, password }, { timeout: 10000 });
    return {
      email: address,
      token: tokenRes.data?.token,
      password,
      provider: 'mailtm',
      createdAt: new Date().toISOString()
    };
  }

  static async getInboxMailTm(token) {
    try {
      const res = await axios.get('https://api.mail.tm/messages', {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      });
      const list = res.data?.['hydra:member'] || [];
      const messages = [];

      for (const m of list) {
        let text = '';
        let html = '';
        try {
          const detail = await axios.get(`https://api.mail.tm/messages/${m.id}`, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 8000
          });
          html = Array.isArray(detail.data?.html) ? detail.data.html.join('') : (detail.data?.html || '');
          text = detail.data?.text || detail.data?.intro || '';
        } catch (_) {}

        messages.push({
          id: String(m.id || ''),
          from: m.from?.address || m.from?.name || 'Unknown',
          subject: m.subject || '(Tanpa Subjek)',
          date: m.createdAt || new Date().toISOString(),
          text,
          html
        });
      }
      return messages;
    } catch (_) {
      return [];
    }
  }

  // 3. Generator.email (HTML Scraper Engine)
  static async createGeneratorEmail(customPrefix = '') {
    const domain = await this.fetchGeneratorDomain();
    const randNum = Math.floor(100000 + Math.random() * 900000);
    const user = (customPrefix || `gen${randNum}`).replace(/[^a-zA-Z0-9_.-]/g, '');
    const email = `${user}@${domain}`.toLowerCase();

    return {
      email,
      user,
      domain,
      provider: 'generator.email',
      inboxPageUrl: `${GENERATOR_BASE_URL}${domain}/${user}`,
      createdAt: new Date().toISOString()
    };
  }

  static async getInboxGeneratorEmail(session) {
    const email = session.email;
    if (!email || !email.includes('@')) return [];
    const [user, domain] = email.split('@');
    const directUrl = `${GENERATOR_BASE_URL}${domain}/${user}`;

    try {
      const pageRes = await axios.get(directUrl, {
        headers: {
          ...DEFAULT_HEADERS,
          'Referer': directUrl
        },
        timeout: 12000
      });

      const html = typeof pageRes.data === 'string' ? pageRes.data : '';
      if (!html) return [];

      const $ = cheerio.load(html);
      const messages = [];

      // Deteksi langsung tautan verifikasi/oobCode
      const directOob = html.match(/https:\/\/[^\s"'<>]+oobCode=[a-zA-Z0-9_\-]+[^\s"'<>]*/i);

      const rows = $('#email-table > div, .email-table-mb > div, [class*="list-group-item"]');
      for (let i = 0; i < rows.length; i++) {
        const el = rows[i];
        const rowText = $(el).text().trim();
        if (rowText.includes('From') && rowText.includes('Subject')) continue;

        const from = $(el).find('[class*="from_div"]').text().trim() || 'Verifikasi Masuk';
        const subject = $(el).find('[class*="subj_div"]').text().trim() || 'Pesan Baru';
        const date = $(el).find('[class*="time_div"]').text().trim() || '';

        messages.push({
          id: String(Date.now() - i),
          from,
          subject,
          date,
          text: rowText,
          html
        });
      }

      if (messages.length === 0 && directOob) {
        messages.push({
          id: String(Date.now()),
          from: 'Sistem Verifikasi',
          subject: 'Tautan Verifikasi / Magic Link',
          date: new Date().toISOString(),
          text: directOob[0],
          html: directOob[0]
        });
      }

      return messages;
    } catch (_) {
      return [];
    }
  }
}

// ==========================================
// EXPORT DEFAULT PLUGIN ZAPO-JS
// ==========================================
export default {
  command: 'tempmail',
  alias: ['mailtemp', 'fakemail', 'inbox', 'cekinbox', 'kotakmasuk'],
  category: 'tools',
  description: 'Multi-Engine Disposable Email (TempMail.chat, Mail.tm, Generator.email)',
  onlyOwner: false,

  async execute(m, context) {
    const { args } = context;
    const subCmd = (args[0] || '').toLowerCase();
    const sender = m.sender;

    // 1. CEK KOTAK MASUK (INBOX)
    if (subCmd === 'inbox' || subCmd === 'check' || subCmd === 'cek') {
      const activeSession = getUserSession(sender);
      if (!activeSession || !activeSession.email) {
        return await m.reply(
          `❌ *Belum ada email aktif!*\n\n` +
          `Silakan buat email sementara terlebih dahulu dengan perintah:\n` +
          `👉 *.tempmail new*`
        );
      }

      await m.reply(`⏳ *Memeriksa kotak masuk untuk:* \n\`${activeSession.email}\`...`);

      let messages = [];
      try {
        if (activeSession.provider === 'tempmail-chat') {
          messages = await UniversalTempMail.getInboxTempMailChat(activeSession.token);
        } else if (activeSession.provider === 'mailtm') {
          messages = await UniversalTempMail.getInboxMailTm(activeSession.token);
        } else if (activeSession.provider === 'generator.email') {
          messages = await UniversalTempMail.getInboxGeneratorEmail(activeSession);
        }
      } catch (err) {
        return await m.reply(`❌ *Gagal mengambil pesan:* ${err.message}`);
      }

      if (!messages || messages.length === 0) {
        return await m.reply(
          `📬 *Kotak Masuk Kosong*\n\n` +
          `Belum ada email masuk untuk:\n\`${activeSession.email}\`\n\n` +
          `_Kirim pesan/OTP sekarang, lalu ketik *.tempmail inbox* lagi setelah beberapa detik._`
        );
      }

      let resText = `📬 *KOTAK MASUK SEMENTARA (${messages.length} Pesan)*\n`;
      resText += `📧 *Email:* \`${activeSession.email}\`\n`;
      resText += `🌐 *Provider:* ${activeSession.provider}\n`;
      resText += `────────────────────────────\n\n`;

      for (let i = 0; i < messages.length; i++) {
        const item = messages[i];
        resText += `📨 *Pesan #${i + 1}*\n`;
        resText += `👤 *Dari:* ${item.from}\n`;
        resText += `📌 *Subjek:* ${item.subject}\n`;
        resText += `🕒 *Waktu:* ${item.date}\n\n`;

        // Deteksi Kode OTP / Magic Link secara otomatis
        const fullContent = `${item.subject} ${item.text} ${item.html}`;
        const links = fullContent.match(/https?:\/\/[^\s"'<>]+/g) || [];
        const otpMatches = fullContent.match(/\b\d{4,8}\b/g) || [];

        if (otpMatches.length > 0) {
          resText += `🔑 *Kemungkinan OTP:* \`${otpMatches[0]}\`\n`;
        }

        if (links.length > 0) {
          // Cari link konfirmasi/verifikasi utama
          const verifyLink = links.find((l) => l.includes('verify') || l.includes('confirm') || l.includes('oobCode') || l.includes('token') || l.includes('finish')) || links[0];
          resText += `🔗 *Tautan Verifikasi / Magic Link:*\n${verifyLink}\n\n`;
        }

        if (item.text) {
          const previewText = item.text.replace(/[\r\n]+/g, ' ').slice(0, 200);
          resText += `📄 *Isi Pesan:*\n_${previewText}${item.text.length > 200 ? '...' : ''}_\n`;
        }
        resText += `────────────────────────────\n`;
      }

      return await m.reply(resText);
    }

    // 2. HAPUS SESI EMAIL AKTIF
    if (subCmd === 'delete' || subCmd === 'del' || subCmd === 'hapus') {
      saveUserSession(sender, null);
      return await m.reply('🗑️ *Sesi email sementara Anda berhasil dihapus dari bot.*');
    }

    // 3. BUAT ALAMAT EMAIL BARU
    if (subCmd === 'new' || subCmd === 'create' || subCmd === 'buat' || subCmd === '') {
      const providerArg = (args[1] || 'chat').toLowerCase();
      const customName = (args[2] || '').trim();

      await m.reply('⏳ *Menghubungi server penyedia email sementara...*');

      let session = null;
      try {
        if (providerArg === 'mailtm' || providerArg === 'tm') {
          session = await UniversalTempMail.createMailTm(customName);
        } else if (providerArg === 'gen' || providerArg === 'generator') {
          session = await UniversalTempMail.createGeneratorEmail(customName);
        } else {
          // Default: TempMail.chat (Cloudflare Workers - Respon instan)
          try {
            session = await UniversalTempMail.createTempMailChat();
          } catch (_) {
            session = await UniversalTempMail.createMailTm(customName);
          }
        }

        saveUserSession(sender, session);

        let out = `🎉 *EMAIL SEMENTARA BERHASIL DIBUAT!*\n\n`;
        out += `📧 *Alamat Email:*\n\`${session.email}\`\n\n`;
        out += `🌐 *Provider:* ${session.provider}\n`;

        if (session.password) {
          out += `🔑 *Password Mail.tm:* \`${session.password}\`\n`;
        }

        out += `\n📋 *PANDUAN PENGGUNAAN:*\n`;
        out += `1. Salin alamat email di atas untuk daftar akun/verifikasi.\n`;
        out += `2. Tunggu email konfirmasi masuk.\n`;
        out += `3. Ketik *.tempmail inbox* untuk membaca pesan & mengambil kode OTP / Magic Link.\n`;
        out += `4. Ketik *.tempmail del* jika sudah selesai menggunakan.`;

        return await m.reply(out);

      } catch (err) {
        return await m.reply(`❌ *Gagal membuat email:* ${err.message}`);
      }
    }

    // DEFAULT MENU BANTUAN
    let help = `⚡ *UNIVERSAL TEMPMAIL ENGINE*\n\n`;
    help += `1. *Buat Email Baru (Cepat):*\n`;
    help += `👉 \`.tempmail new\`\n\n`;
    help += `2. *Buat Email via Mail.tm (Kustom Prefix):*\n`;
    help += `👉 \`.tempmail new mailtm [nama]\`\n\n`;
    help += `3. *Buat Email via Generator.email (Random Domain):*\n`;
    help += `👉 \`.tempmail new gen [nama]\`\n\n`;
    help += `4. *Periksa Kotak Masuk (Cek OTP):*\n`;
    help += `👉 \`.tempmail inbox\`\n\n`;
    help += `5. *Hapus Sesi Mailbox:*\n`;
    help += `👉 \`.tempmail del\``;

    return await m.reply(help);
  }
};