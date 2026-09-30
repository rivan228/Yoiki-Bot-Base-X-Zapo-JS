// plugins/bot/gustod.js
import axios from 'axios';
import fs from 'fs';
import path from 'path';

// Cache percakapan di RAM (Key: chatJid_senderJid)
const chatSessions = new Map();
const SESSION_TTL = 15 * 60 * 1000; // 15 menit idle auto-reset

// Cache model aktif
let cachedActiveModel = 'gemini-3.1-pro-preview';
let lastModelCheck = 0;

// Auto-cleaner memori Pterodactyl container tiap 5 menit
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of chatSessions.entries()) {
    if (now - session.lastActive > SESSION_TTL) {
      chatSessions.delete(key);
    }
  }
}, 5 * 60 * 1000);

// Helper: Ekstraksi angka nomor telepon murni
function getCleanNumber(raw) {
  if (Array.isArray(raw)) return getCleanNumber(raw[0]);
  if (typeof raw === 'object' && raw !== null) {
    return getCleanNumber(raw.id || raw.jid || raw.number || Object.values(raw)[0]);
  }
  return String(raw || '')
    .split('@')[0]
    .split(':')[0]
    .replace(/[^0-9]/g, '');
}

// Helper: Ambil API Key dari config / memory / fisik file settings.js
function getGeminiApiKey(context) {
  if (global.geminiKey) return global.geminiKey;
  if (global.config?.geminiKey) return global.config.geminiKey;
  if (global.setting?.geminiKey) return global.setting.geminiKey;
  if (global.settings?.geminiKey) return global.settings.geminiKey;
  if (context?.config?.geminiKey) return context.config.geminiKey;
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;

  const configFiles = ['settings.js', 'config.js', 'setting.js', 'src/settings.js', 'src/config.js'];
  for (const file of configFiles) {
    try {
      const filePath = path.resolve(process.cwd(), file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const match = content.match(/(?:geminiKey|apiKeyGemini|geminiApiKey)\s*:\s*['"`]([^'"`]+)['"`]/i);
        if (match && match[1] && !match[1].includes('AIzaSyD-xxx')) {
          return match[1].trim();
        }
      }
    } catch (_) {}
  }
  return null;
}

// Helper: Cek apakah pengirim adalah Owner bot
function checkIsOwner(m, sock, senderJid) {
  if (m.key?.fromMe) return true;
  const senderDigits = getCleanNumber(senderJid);
  const botDigits = getCleanNumber(sock?.user?.id);
  if (senderDigits && botDigits && senderDigits === botDigits) return true;

  const rawOwners = [
    ...(Array.isArray(global.owner) ? global.owner : [global.owner]),
    global.nomorowner,
    global.nobot,
    global.ownerNumber
  ].filter(Boolean);

  for (const item of rawOwners) {
    const ownerDigits = getCleanNumber(item);
    if (ownerDigits && senderDigits === ownerDigits) return true;
  }
  return false;
}

// Daftar model yang sudah ditutup/deprecated oleh Google untuk API key baru
const DEPRECATED_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-001',
  'gemini-1.5-flash',
  'gemini-1.5-pro'
];

// Dynamic Model Discovery: Ambil model aktif seri Gemini 3.x
async function resolveWorkingGeminiModel(apiKey) {
  const now = Date.now();
  if (cachedActiveModel && now - lastModelCheck < 60 * 60 * 1000) {
    return cachedActiveModel;
  }

  try {
    const { data } = await axios.get(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      {
        headers: {
          'x-goog-api-key': apiKey,
          'User-Agent': 'Mozilla/5.0'
        },
        timeout: 10000
      }
    );

    const models = data?.models || [];
    const valid = models
      .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((name) => !DEPRECATED_MODELS.some((dep) => name === dep || name.startsWith(dep)));

    if (valid.length > 0) {
      // Prioritaskan model generasi 3 terbaru
      const preference = [
        'gemini-3.1-pro-preview',
        'gemini-3.5-flash',
        'gemini-3-flash-preview',
        'gemini-3.1-flash-lite',
        'gemini-3.8-flash',
        'gemini-3-pro-preview'
      ];

      for (const p of preference) {
        if (valid.includes(p)) {
          cachedActiveModel = p;
          lastModelCheck = now;
          return p;
        }
      }

      cachedActiveModel = valid[0];
      lastModelCheck = now;
      return valid[0];
    }
  } catch (err) {
    console.warn('[Gemini Discovery Warn]:', err.response?.data?.error?.message || err.message);
  }

  return 'gemini-3.1-pro-preview';
}

// System Prompt Lengkap: Persona Gustod + Aturan Khusus Pembuatan Plugin Zapo-JS
const SYSTEM_PROMPT = `
Kamu adalah "Gustod" (sering dipanggil "Gustod" atau akrabnya "Tod").
Kamu adalah asisten AI pribadi yang cerdas, santai, gaul, berwibawa, dan sangat solutif.

KEPRIBADIAN & GAYA BICARA:
1. Panggilan diri: "Gue" dan memanggil lawan bicara "Lo" atau "Kak" (sesuaikan konteks santai akrab).
2. Gaya bicara santai ala anak tongkrongan Indonesia yang cerdas, tidak kaku seperti robot atau customer service.
3. Cepat tanggap jika dipanggil "tod", "gustod", atau diajak ngobrol.
4. Jangan pernah menjawab dengan kalimat template kaku. Bersikaplah natural seolah kamu teman yang selalu aktif di WhatsApp.

INSTRUKSI KHUSUS OWNER (KODE & FITUR PLUGIN):
Jika pengirim terdeteksi sebagai "Owner" dan meminta dibuatkan, diperbaiki, atau disesuaikan fitur plugin WhatsApp:
Kamu BUKAN sekadar AI gimmick. Kamu WAJIB memberikan kode utuh JavaScript siap pakai yang 100% mematuhi arsitektur bot Zapo-JS berikut:
- Baris pertama WAJIB komentar path file: // plugins/<kategori>/<nama_file>.js
  (Kategori yang tersedia: bot, chanel, grup, konvert, owner, search, tools, store, downloader)
- Wajib ESM murni (pakai import / export, DILARANG pakai require lokal privat).
- Format kirim pesan & media wajib pakai engine Zapo-JS:
  sock.message.send(m.chat, { text: "..." }, { quoted: m })
  sock.message.send(m.chat, { type: 'video' | 'image' | 'audio' | 'document' | 'sticker', media: bufferOrPath, caption: "..." }, { quoted: m })
- Struktur ekspor wajib Universal:
  export const config = { name: ['cmd'], command: 'cmd', alias: [], category: '...', description: '...', onlyOwner: false };
  export const handler = execute;
  export const run = execute;
  export default { command: 'cmd', name: ['cmd'], alias: [], category: '...', description: '...', onlyOwner: false, execute, run: execute, handler: execute };
- Pembersihan file temporary di ./tmp/ wajib di blok finally { fs.unlinkSync(...) }.
`.trim();

// Engine Pemanggil Gemini API dengan Auto-Healer & Gemini 3 Support
async function askGemini(apiKey, history, currentText, isOwner, senderName) {
  let activeModel = await resolveWorkingGeminiModel(apiKey);

  const ownerNote = isOwner
    ? `\n[SISTEM: User ini adalah OWNER RESMI bot (Nama: ${senderName}). Perlakukan sangat istimewa dan buatkan kode plugin Zapo-JS utuh jika diminta.]`
    : `\n[SISTEM: User ini adalah teman biasa (Nama: ${senderName}).]`;

  const contents = [
    ...history,
    {
      role: 'user',
      parts: [{ text: `${currentText}${ownerNote}` }]
    }
  ];

  // Model prioritas 2026
  const modelCandidates = [
    activeModel,
    'gemini-3.1-pro-preview',
    'gemini-3.5-flash',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite'
  ];
  const uniqueModels = [...new Set(modelCandidates)];

  let lastError = null;

  for (let i = 0; i < uniqueModels.length; i++) {
    const model = uniqueModels[i];

    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const { data } = await axios.post(
        endpoint,
        {
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }]
          },
          contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 4096
          }
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          timeout: 45000
        }
      );

      const candidate = data?.candidates?.[0];
      const replyText = candidate?.content?.parts?.map((p) => p.text).join('') || '';

      if (replyText.trim()) {
        cachedActiveModel = model;
        return replyText.trim();
      }
    } catch (err) {
      lastError = err;
      const errMsg = err.response?.data?.error?.message || err.message || '';

      // AUTO-HEALER: Jika Google merekomendasikan model lain di pesan error, tangkap dan coba model tersebut
      const suggestedMatch = errMsg.match(/use\s+(?:models\/)?([a-zA-Z0-9_.-]+)/i);
      if (suggestedMatch && suggestedMatch[1]) {
        const recommendedModel = suggestedMatch[1].replace(/^models\//, '');
        if (!uniqueModels.includes(recommendedModel)) {
          uniqueModels.push(recommendedModel);
        }
      }

      // Fallback jika model tertentu menolak objek systemInstruction
      if (err.response?.status === 400 && errMsg.includes('systemInstruction')) {
        try {
          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const fallbackContents = [
            ...history,
            {
              role: 'user',
              parts: [{ text: `[INSTRUKSI SISTEM: ${SYSTEM_PROMPT}]\n\n${currentText}${ownerNote}` }]
            }
          ];

          const fallbackRes = await axios.post(
            endpoint,
            {
              contents: fallbackContents,
              generationConfig: { temperature: 0.7, maxOutputTokens: 4096 }
            },
            {
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
              timeout: 45000
            }
          );

          const fbCandidate = fallbackRes.data?.candidates?.[0];
          const fbReply = fbCandidate?.content?.parts?.map((p) => p.text).join('') || '';
          if (fbReply.trim()) {
            cachedActiveModel = model;
            return fbReply.trim();
          }
        } catch (_) {}
      }

      continue;
    }
  }

  throw new Error(lastError?.response?.data?.error?.message || lastError?.message || 'Server Gemini gagal merespon.');
}

// Fungsi pemroses chat AI
async function processGustodChat(m, context, userPrompt) {
  const sock = context?.sock || context?.Cantarella || global.sock;
  const senderJid = m.sender || m.key?.participant || '';
  const senderName = m.pushName || 'Kawan';

  const sendReply = async (text) => {
    try {
      if (typeof m.reply === 'function') return await m.reply(text);
      return await sock.message.send(m.chat, { text }, { quoted: m });
    } catch (_) {
      try {
        return await sock.message.send(m.chat, { text });
      } catch (e) {
        console.error('[Gustod AI] Gagal kirim balasan:', e.message);
      }
    }
  };

  const apiKey = getGeminiApiKey(context);

  if (!apiKey) {
    return await sendReply(
      '⚠️ *API KEY GEMINI BELUM TERBACA!*\n\n' +
      'Pastikan di `settings.js` kamu sudah tertulis:\n' +
      '> `geminiKey: "AIzaSyD-xxxxxxxxxxxxxx",`\n\n' +
      '_Dapatkan API key gratis di: aistudio.google.com_'
    );
  }

  const isOwner = checkIsOwner(m, sock, senderJid);
  const sessionKey = `${m.chat}_${senderJid}`;

  if (!chatSessions.has(sessionKey)) {
    chatSessions.set(sessionKey, { history: [], lastActive: Date.now() });
  }

  const session = chatSessions.get(sessionKey);
  session.lastActive = Date.now();

  try {
    if (typeof m.react === 'function') m.react('💬').catch(() => {});

    const aiAnswer = await askGemini(apiKey, session.history, userPrompt, isOwner, senderName);

    session.history.push({ role: 'user', parts: [{ text: userPrompt }] });
    session.history.push({ role: 'model', parts: [{ text: aiAnswer }] });
    if (session.history.length > 10) {
      session.history = session.history.slice(-10);
    }

    await sendReply(aiAnswer);

    if (typeof m.react === 'function') m.react('✅').catch(() => {});
  } catch (err) {
    console.error('[Gustod AI Error]:', err.message);
    if (typeof m.react === 'function') m.react('❌').catch(() => {});
    await sendReply(`❌ *Waduh, otak gue nge-lag bentar:* ${err.message}`);
  }
}

// 1. Eksekusi via Command (.tod / .gustod / .ai)
const execute = async (m, context) => {
  const args = context?.args || (m.text ? m.text.trim().split(/\s+/).slice(1) : []);
  const prompt = args.join(' ').trim() || m.quoted?.text || '';

  if (!prompt) {
    const sendReply = async (text) => {
      try {
        if (typeof m.reply === 'function') return await m.reply(text);
        return await context.sock.message.send(m.chat, { text }, { quoted: m });
      } catch (_) {}
    };

    return await sendReply(
      `😎 *GUSTOD AI ASSISTANT*\n\n` +
      `Gue Gustod, panggil aja *Tod*.\n\n` +
      `*Cara panggil gue:*\n` +
      `• Pake command: \`.tod <pertanyaan>\` atau \`.gustod <pertanyaan>\`\n` +
      `• Reply chat gue langsung\n` +
      `• Panggil langsung: _"tod rekomendasi lagu dong"_\n\n` +
      `_Contoh: .tod siapa presiden pertama indonesia?_`
    );
  }

  await processGustodChat(m, context, prompt);
};

// 2. Eksekusi otomatis jika ada panggilan nama / reply / mention tanpa prefix
export const before = async (m, context) => {
  const sock = context?.sock || context?.Cantarella || global.sock;
  if (!m || m.key?.fromMe) return;

  const botNum = getCleanNumber(sock?.user?.id);
  const bodyText = (m.text || m.caption || m.body || '').trim();
  if (!bodyText) return;

  // Jangan ganggu command bot lain yang memakai prefix
  const isPrefix = /^[°•π÷×¶∆£¢€¥®™✓_=|~!?#$%^&.+-,\/\\©^]/.test(bodyText);
  if (isPrefix) return;

  const isTagged = Array.isArray(m.mentionedJid) && m.mentionedJid.some((j) => getCleanNumber(j) === botNum);
  const isReplyToBot = Boolean(
    m.quoted && (m.quoted.fromMe || getCleanNumber(m.quoted.sender) === botNum)
  );
  const isCalledName = /\b(gustod|tod)\b/i.test(bodyText);

  if (isTagged || isReplyToBot || isCalledName) {
    const cleanPrompt = bodyText.replace(new RegExp(`@?${botNum}`, 'g'), '').trim();
    await processGustodChat(m, context, cleanPrompt || 'Oi Tod!');
  }
};

// -------------------------------------------------------------
// UNIVERSAL EXPORT (Mendukung semua jenis loader bot Zapo-JS)
// -------------------------------------------------------------
export const config = {
  name: ['gustod', 'tod', 'ai', 'gustodai'],
  command: 'gustod',
  alias: ['tod', 'ai', 'gustodai'],
  category: 'bot',
  description: 'AI Pintar Gustod yang auto-respon saat dipanggil, direply, atau ditag',
  onlyOwner: false
};

export const handler = execute;
export const run = execute;

export default {
  command: 'gustod',
  name: ['gustod', 'tod', 'ai', 'gustodai'],
  alias: ['tod', 'ai', 'gustodai'],
  category: 'bot',
  description: 'AI Pintar Gustod yang auto-respon saat dipanggil, direply, atau ditag',
  onlyOwner: false,
  execute,
  run: execute,
  handler: execute,
  before
};