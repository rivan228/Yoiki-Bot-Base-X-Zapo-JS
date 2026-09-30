// plugins/tools/alightmotion.js

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import https from 'https';
import axios from 'axios';
import * as cheerio from 'cheerio';

// ==========================================
// KONFIGURASI ENGINE
// ==========================================
const FIREBASE_WEB_API_KEY = process.env.ALIGHT_API_KEY || "AIzaSyDrZ9jr_Y16ltSBqsQR5IH6I04FRga6Ki0";
const FIREBASE_AUTH_BASE = "https://identitytoolkit.googleapis.com/v1/accounts";
const SECURE_TOKEN_BASE = "https://securetoken.googleapis.com/v1/token";
const CLOUD_FUNCTIONS_BASE = "https://us-central1-alight-creative.cloudfunctions.net";
const ALIGHT_CONTINUE_URL = "https://alightcreative.com/am/auth/finish";

const STORAGE_DIR = path.join(process.cwd(), "storage", "alightmotion");
const MASTER_SESSION_FILE = path.join(STORAGE_DIR, "master-session.json");
const PRO_ACCOUNTS_FILE = path.join(STORAGE_DIR, "pro-accounts.json");
const GENERATED_ACCOUNTS_FILE = path.join(STORAGE_DIR, "generated-accounts.json");
const TMP_DIR = path.join(process.cwd(), "tmp");

const secureHttpsAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

const NATIVE_HEADERS = {
  "Content-Type": "application/json",
  "Origin": "https://alight-creative.firebaseapp.com",
  "Referer": "https://alight-creative.firebaseapp.com/",
  "User-Agent": "Mozilla/5.0 (Linux; Android 13; Redmi Note 7 Build/TQ3A.230901.001.B1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36"
};

// Map Sesi Interaktif
const userInteractiveStates = new Map();

// ==========================================
// FILE SYSTEM HELPERS
// ==========================================
function readJsonSafe(filePath, defaultVal = {}) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {}
  return defaultVal;
}

function writeJsonSafe(filePath, data) {
  try {
    const targetDir = path.dirname(filePath);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (_) {
    return false;
  }
}

function loadMasterSession() {
  const fileData = readJsonSafe(MASTER_SESSION_FILE, null);
  if (fileData) return fileData;
  if (process.env.ALIGHT_MASTER_REFRESH_TOKEN || process.env.ALIGHT_MASTER_TOKEN) {
    return {
      email: process.env.ALIGHT_MASTER_EMAIL || "master@alight.local",
      idToken: process.env.ALIGHT_MASTER_TOKEN || "",
      refreshToken: process.env.ALIGHT_MASTER_REFRESH_TOKEN || "",
      localId: process.env.ALIGHT_MASTER_UID || "",
      isPro: true,
      updatedAt: new Date().toISOString()
    };
  }
  return null;
}

function saveMasterSession(sessionData) {
  writeJsonSafe(MASTER_SESSION_FILE, sessionData);
  const proAccs = readJsonSafe(PRO_ACCOUNTS_FILE, {});
  proAccs[sessionData.email.toLowerCase().trim()] = {
    ...sessionData,
    category: "pro",
    updatedAt: new Date().toISOString()
  };
  writeJsonSafe(PRO_ACCOUNTS_FILE, proAccs);
}

function loadGeneratedAccounts() {
  return readJsonSafe(GENERATED_ACCOUNTS_FILE, {});
}

function saveGeneratedAccount(email, data) {
  const accs = readJsonSafe(GENERATED_ACCOUNTS_FILE, {});
  accs[email.toLowerCase().trim()] = {
    ...data,
    category: "generated",
    updatedAt: new Date().toISOString()
  };
  writeJsonSafe(GENERATED_ACCOUNTS_FILE, accs);
}

// ==========================================
// ALIGHT CORE ENGINE FUNCTIONS
// ==========================================
function generateDeviceProfile() {
  const certVariants = [
    "ECA6BF91B8715A6F810ED0BBFC65B6CD578F52A8",
    "EC:A6:BF:91:B8:71:5A:6F:81:0E:D0:BB:FC:65:B6:CD:57:8F:52:A8"
  ];
  const cert = certVariants[Math.floor(Math.random() * certVariants.length)];
  const androidId = crypto.randomBytes(8).toString("hex").toLowerCase();
  const fcmPart1 = crypto.randomBytes(11).toString("base64url");
  const fcmPart2 = crypto.randomBytes(90).toString("base64url").slice(0, 134);
  const fcmToken = `cSDnCyp3T-${fcmPart1}:APA91b${fcmPart2}`;

  return {
    cert,
    androidId,
    fcmToken,
    headers: {
      "X-Android-Package": "com.alightcreative.motion",
      "X-Android-Cert": cert,
      "X-Android-Device-Id": androidId,
      "X-Android-Id": androidId,
      "firebase-instance-id-token": fcmToken
    }
  };
}

function extractOobCode(urlOrText) {
  if (!urlOrText) return "";
  const match = urlOrText.match(/oobCode=([a-zA-Z0-9_\-]+)/);
  if (match && match[1]) return match[1];
  try {
    const urlObj = new URL(urlOrText);
    const code = urlObj.searchParams.get("oobCode");
    if (code) return code;
  } catch (_) {}
  return urlOrText.trim();
}

async function sendMagicLink(email) {
  const payload = {
    requestType: "EMAIL_SIGNIN",
    email: email.trim(),
    continueUrl: ALIGHT_CONTINUE_URL,
    canHandleCodeInApp: true
  };

  const res = await axios.post(
    `${FIREBASE_AUTH_BASE}:sendOobCode?key=${FIREBASE_WEB_API_KEY}`,
    payload,
    {
      headers: NATIVE_HEADERS,
      httpsAgent: secureHttpsAgent,
      timeout: 15000
    }
  );

  return { email: res.data?.email || email };
}

async function verifyMagicLink(email, magicLinkOrCode) {
  const oobCode = extractOobCode(magicLinkOrCode);
  const payload = { email: email.trim(), oobCode };

  const res = await axios.post(
    `${FIREBASE_AUTH_BASE}:signInWithEmailLink?key=${FIREBASE_WEB_API_KEY}`,
    payload,
    {
      headers: NATIVE_HEADERS,
      httpsAgent: secureHttpsAgent,
      timeout: 15000
    }
  );

  return {
    email: res.data?.email || email,
    localId: res.data?.localId,
    idToken: res.data?.idToken,
    refreshToken: res.data?.refreshToken
  };
}

async function refreshUserToken(refreshToken) {
  const res = await axios.post(
    `${SECURE_TOKEN_BASE}?key=${FIREBASE_WEB_API_KEY}`,
    `grant_type=refresh_token&refresh_token=${refreshToken.trim()}`,
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      httpsAgent: secureHttpsAgent,
      timeout: 15000
    }
  );
  return { idToken: res.data?.id_token, refreshToken: res.data?.refresh_token || refreshToken };
}

async function getLicenseStatus(idToken) {
  const device = generateDeviceProfile();
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "user-agent": "okhttp/3.12.1",
    ...device.headers
  };
  if (idToken) headers["authorization"] = `Bearer ${idToken.trim()}`;

  const res = await axios.post(
    `${CLOUD_FUNCTIONS_BASE}/getAccountStatus`,
    {
      data: {
        package: "com.alightcreative.motion",
        version: "5.0.279"
      }
    },
    {
      headers,
      httpsAgent: secureHttpsAgent,
      timeout: 15000
    }
  );

  const result = res.data?.result || {};
  return {
    isPro: Boolean(result.licenseValid),
    expiresAt: result.licenseExpires ? new Date(Number(result.licenseExpires)).toISOString() : null,
    benefits: result.licenseBenefits || [],
    details: result.licenseDetails || {}
  };
}

async function applyPremium(idToken, purchaseToken) {
  const orderId = `omnifylabs-${crypto.randomBytes(6).toString("hex")}`;
  const device = generateDeviceProfile();

  const headers = {
    authorization: `Bearer ${idToken.trim()}`,
    "content-type": "application/json; charset=utf-8",
    "user-agent": "okhttp/3.12.1",
    ...device.headers
  };

  const res = await axios.post(
    `${CLOUD_FUNCTIONS_BASE}/verifyPurchase`,
    {
      data: {
        productId: "am.full.sub.annual.19q4",
        token: purchaseToken,
        skuType: "subs",
        orderId
      }
    },
    {
      headers,
      httpsAgent: secureHttpsAgent,
      timeout: 15000
    }
  );

  return { success: true, data: res.data, orderId };
}

async function downloadPreset(alightUrl) {
  const res = await axios.get(alightUrl.trim(), {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
    },
    maxRedirects: 5,
    timeout: 20000,
    httpsAgent: secureHttpsAgent
  });

  const html = res.data;
  const $ = cheerio.load(html);

  const title = $('meta[property="og:title"]').attr("content") || $("title").text() || "Alight Motion Preset";
  const description = $('meta[property="og:description"]').attr("content") || "No Description";
  const thumbnail = $('meta[property="og:image"]').attr("content") || null;

  let xmlUrl = null;
  let audioUrl = null;

  const storageMatches = html.match(/https:\/\/storage\.googleapis\.com\/bsp-alight-creative-cms-public\/[^\s"'<>()]+/g) || [];
  if (storageMatches.length > 0) xmlUrl = storageMatches[0];

  const audioMatches = html.match(/https:\/\/[^\s"'<>]+\.(?:mp3|m4a|wav|aac)/gi) || [];
  if (audioMatches.length > 0) audioUrl = audioMatches[0];

  return { title: title.replace(/\s+/g, " ").trim(), description: description.trim(), thumbnail, xmlUrl, audioUrl };
}

function getDeepText(m) {
  if (!m) return "";
  const q = m.quoted;
  const msg = q?.message || q || m.message;
  const inner = msg?.viewOnceMessage?.message ||
                msg?.viewOnceMessageV2?.message ||
                msg?.ephemeralMessage?.message ||
                msg;

  return inner?.conversation ||
         inner?.extendedTextMessage?.text ||
         inner?.imageMessage?.caption ||
         inner?.videoMessage?.caption ||
         q?.text ||
         m.text ||
         "";
}

// ==========================================
// EXPORT DEFAULT PLUGIN ZAPO-JS
// ==========================================
export default {
  command: "alightmotion",
  alias: ["alight", "am", "ampreset"],
  category: "tools",
  description: "Alight Motion Suite Multi-Feature (Menu 0-8 Full Active)",
  onlyOwner: false,

  async execute(m, context) {
    const { sock, args } = context;

    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
    if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });

    const sender = m.sender;
    const rawInput = (args.join(" ") || getDeepText(m)).trim();
    const cmdArg = (args[0] || "").toLowerCase();

    // 0. RESET / BATAL SESI
    if (cmdArg === "batal" || cmdArg === "q" || cmdArg === "exit") {
      userInteractiveStates.delete(sender);
      return await m.reply("🛑 *Sesi Alight Motion berhasil dibatalkan.*");
    }

    // ========================================================
    // DETEKSI OTOMATIS LINK ALIGHT (PRESET DOWNLOADER)
    // ========================================================
    const isAlightUrl = rawInput.includes("alight.link") || rawInput.includes("alightcreative.com/am/share");
    if (cmdArg === "8" || isAlightUrl) {
      const urlMatch = rawInput.match(/https?:\/\/[^\s]+/);
      if (!urlMatch) {
        return await m.reply(
          `📦 *MENU [8] DOWNLOAD PRESET XML & AUDIO*\n\n` +
          `Ketik: *.alight 8 <url_alight_link>*\n` +
          `_Contoh: .alight 8 https://alight.link/xxxx_`
        );
      }

      const targetUrl = urlMatch[0];
      await m.reply("⏳ *Mengunduh metadata & berkas preset Alight Motion...*");

      const tempFiles = [];
      try {
        const preset = await downloadPreset(targetUrl);
        const safeTitle = preset.title.replace(/[/\\?%*:|"<>]/g, "_").slice(0, 50) || "Preset_Alight";

        let captionInfo = `📦 *ALIGHT MOTION PRESET DOWNLOADER*\n\n`;
        captionInfo += `📌 *Judul:* ${preset.title}\n`;
        captionInfo += `📝 *Deskripsi:* ${preset.description}\n`;
        captionInfo += `🔗 *Link Preset:* ${targetUrl}\n\n`;
        captionInfo += `_Mengirim berkas project..._`;

        if (preset.thumbnail) {
          try {
            const thumbRes = await axios.get(preset.thumbnail, { responseType: "arraybuffer", timeout: 15000 });
            await sock.message.send(m.chat, { type: "image", media: Buffer.from(thumbRes.data), caption: captionInfo }, { quoted: m });
          } catch (_) {
            await m.reply(captionInfo);
          }
        } else {
          await m.reply(captionInfo);
        }

        if (preset.xmlUrl) {
          const xmlPath = path.join(TMP_DIR, `${safeTitle}_${Date.now()}.xml`);
          tempFiles.push(xmlPath);
          const xmlRes = await axios.get(preset.xmlUrl, { responseType: "arraybuffer", timeout: 25000 });
          fs.writeFileSync(xmlPath, xmlRes.data);

          await sock.message.send(m.chat, {
            type: "document",
            media: xmlPath,
            fileName: `${safeTitle}.xml`,
            mimetype: "application/xml"
          }, { quoted: m });
        }

        if (preset.audioUrl) {
          const ext = preset.audioUrl.split(".").pop()?.split("?")[0] || "mp3";
          const audioPath = path.join(TMP_DIR, `${safeTitle}_${Date.now()}.${ext}`);
          tempFiles.push(audioPath);
          const audioRes = await axios.get(preset.audioUrl, { responseType: "arraybuffer", timeout: 30000 });
          fs.writeFileSync(audioPath, audioRes.data);

          await sock.message.send(m.chat, {
            type: "audio",
            media: audioPath,
            mimetype: ext === "mp3" ? "audio/mpeg" : "audio/mp4"
          }, { quoted: m });
        }

      } catch (err) {
        return await m.reply(`❌ *Gagal mengunduh preset:* ${err.message}`);
      } finally {
        for (const f of tempFiles) {
          try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
        }
      }
      return;
    }

    // ========================================================
    // STATE MACHINE / INTERAKTIF HANDLER (UNTUK MENU 2 & 3)
    // ========================================================
    const userState = userInteractiveStates.get(sender);

    if (userState) {
      // Step A: Menunggu konfirmasi kirim link (y/n)
      if (userState.step === "CONFIRM_MAGIC_LINK") {
        const answer = cmdArg;

        if (answer === "n") {
          await m.reply(`⏳ *[*] Mengirim Magic Link login resmi ke "${userState.email}"...*`);
          try {
            await sendMagicLink(userState.email);
            userState.step = "WAITING_OOB_LINK";
            userInteractiveStates.set(sender, userState);

            let msg = `[✓] *Magic Link login resmi Alight Motion berhasil dikirim ke inbox email user.*\n\n`;
            msg += `Silakan buka inbox email (\`${userState.email}\`), salin link login-nya, lalu paste di sini:\n`;
            msg += `👉 Ketik: *.alight <link_login_oob>*\n\n`;
            msg += `_(Ketik *.alight batal* untuk membatalkan)_`;
            return await m.reply(msg);
          } catch (e) {
            userInteractiveStates.delete(sender);
            return await m.reply(`❌ *Gagal mengirim email:* ${e.message}`);
          }
        } else if (answer === "y") {
          userState.step = "WAITING_OOB_LINK";
          userInteractiveStates.set(sender, userState);
          return await m.reply(
            `Silakan tempel (paste) Link OOB login dari email Anda sekarang:\n` +
            `👉 Ketik: *.alight <link_login_oob>*`
          );
        } else {
          return await m.reply(`⚠️ Pilihan tidak valid. Ketik *.alight y* jika sudah ada link, atau *.alight n* jika ingin dikirimkan link.`);
        }
      }

      // Step B: Menunggu tempelan link OOB
      if (userState.step === "WAITING_OOB_LINK") {
        const magicLink = rawInput;
        if (!magicLink.includes("oobCode") && !magicLink.includes("apiKey") && !magicLink.includes("alight")) {
          return await m.reply("❌ Link yang Anda masukkan tidak valid atau tidak memiliki parameter oobCode!");
        }

        // Jika alur dari Menu 3 (Daftar Master)
        if (userState.type === "MASTER") {
          await m.reply(`⏳ *[*] Memverifikasi akun master & memeriksa lisensi ke server Alight Creative...*`);
          try {
            const auth = await verifyMagicLink(userState.email, magicLink);
            const lic = await getLicenseStatus(auth.idToken);

            if (!lic.isPro) {
              userInteractiveStates.delete(sender);
              return await m.reply(
                `❌ *PENDAFTARAN DITOLAK: BUKAN AKUN PRO!*\n\n` +
                `Akun: \`${auth.email}\`\n` +
                `Status: [TIDAK AKTIF / FREE]\n\n` +
                `⚠️ *Catatan:* Hanya akun yang memiliki langganan Pro aktif di Play Store/App Store yang dapat didaftarkan sebagai Akun Master!`
              );
            }

            const purchaseToken = lic.details?.token || lic.details?.purchaseToken || auth.idToken;
            const masterData = {
              email: auth.email,
              localId: auth.localId,
              idToken: auth.idToken,
              refreshToken: auth.refreshToken,
              isPro: true,
              purchaseToken,
              licenseExpires: lic.expiresAt || new Date(Date.now() + 365 * 86400000).toISOString(),
              benefits: lic.benefits || [],
              updatedAt: new Date().toISOString()
            };

            saveMasterSession(masterData);
            userInteractiveStates.delete(sender);

            let successMsg = `🎉 *AKUN MASTER BERHASIL DIDAFTARKAN & TERVERIFIKASI PRO!*\n\n`;
            successMsg += `📧 *Email Master:* \`${auth.email}\`\n`;
            successMsg += `🆔 *UID Firebase:* ${auth.localId}\n`;
            successMsg += `⭐ *Status Pro:* [PRO AKTIF ⭐]\n`;
            successMsg += `📅 *Masa Berlaku:* ${masterData.licenseExpires}\n\n`;
            successMsg += `[✓] SUKSES! Fitur Auto-Generate Akun Pro (.alight 1) sekarang sudah aktif!`;
            return await m.reply(successMsg);

          } catch (err) {
            userInteractiveStates.delete(sender);
            return await m.reply(`❌ *Gagal Verifikasi Master:* ${err.response?.data?.error?.message || err.message}`);
          }
        }

        // Jika alur dari Menu 2 (Manual Pro User)
        if (userState.type === "MANUAL_USER") {
          const masterAcc = loadMasterSession();
          if (!masterAcc || !masterAcc.isPro) {
            userInteractiveStates.delete(sender);
            return await m.reply("❌ Akun Master Pro belum tersedia di bot. Daftarkan di Menu [3] terlebih dahulu.");
          }

          await m.reply(`⏳ *[*] Memverifikasi akun user & menyuntikkan lisensi Pro...*`);
          try {
            const auth = await verifyMagicLink(userState.email, magicLink);
            const purchaseToken = masterAcc.purchaseToken || masterAcc.idToken;
            const applyRes = await applyPremium(auth.idToken, purchaseToken);

            const expiry = new Date(Date.now() + 365 * 86400000).toISOString();
            saveGeneratedAccount(auth.email, {
              email: auth.email,
              localId: auth.localId,
              idToken: auth.idToken,
              refreshToken: auth.refreshToken,
              isPro: true,
              expiresAt: expiry,
              orderId: applyRes.orderId,
              mode: "manual"
            });

            userInteractiveStates.delete(sender);

            let resUser = `🎉 *AKUN USER BERHASIL DIAKTIFKAN PRO!* ⭐\n\n`;
            resUser += `📧 *Email:* \`${auth.email}\`\n`;
            resUser += `⭐ *Status:* PRO AKTIF\n`;
            resUser += `📅 *Expired:* ${expiry}\n`;
            resUser += `🧾 *Order ID:* ${applyRes.orderId}\n\n`;
            resUser += `_Buka aplikasi Alight Motion di HP dan akun sudah Pro!_`;
            return await m.reply(resUser);
          } catch (err) {
            userInteractiveStates.delete(sender);
            return await m.reply(`❌ *Gagal Aktivasi Manual:* ${err.response?.data?.error?.message || err.message}`);
          }
        }
      }
    }

    // ========================================================
    // HANDLER RESMI SETIAP MENU (0 SAMPAI 8)
    // ========================================================
    const master = loadMasterSession();
    const masterBadge = (master && master.isPro)
      ? `[✓ MASTER PRO AKTIF]`
      : `[✕ MASTER BELUM TERDAFTAR / BUKAN PRO — DAFTARKAN DI MENU 3]`;

    // MENU [0]: BATCH GENERATE (N AKUN)
    if (cmdArg === "0") {
      if (!master || !master.isPro) {
        return await m.reply(`❌ *FITUR DIBLOKIR!*\n\nStatus: ${masterBadge}\nBatch Generate memerlukan Akun Master Pro aktif di Menu [3].`);
      }

      const count = Math.max(1, Math.min(10, parseInt(args[1], 10) || 3));
      await m.reply(`⚡ *Memulai Batch Generate untuk ${count} akun secara berurutan...*`);

      let results = [];
      for (let i = 0; i < count; i++) {
        try {
          const domainRes = await axios.get("https://api.mail.tm/domains?page=1", { timeout: 10000 });
          const domain = domainRes.data?.["hydra:member"]?.[0]?.domain;
          const rand = crypto.randomBytes(4).toString("hex");
          const tempEmail = `am_${rand}@${domain}`.toLowerCase();
          const tempPass = `Pass${rand}Aa1!`;

          await axios.post("https://api.mail.tm/accounts", { address: tempEmail, password: tempPass });
          const tRes = await axios.post("https://api.mail.tm/token", { address: tempEmail, password: tempPass });
          const token = tRes.data.token;

          await sendMagicLink(tempEmail);

          let magicLink = null;
          const start = Date.now();
          while (Date.now() - start < 60000) {
            await new Promise((r) => setTimeout(r, 4000));
            const inboxRes = await axios.get("https://api.mail.tm/messages", { headers: { Authorization: `Bearer ${token}` } });
            const msgs = inboxRes.data?.["hydra:member"] || [];

            for (const mItem of msgs) {
              const detail = await axios.get(`https://api.mail.tm/messages/${mItem.id}`, { headers: { Authorization: `Bearer ${token}` } });
              const content = `${detail.data.subject} ${detail.data.text} ${detail.data.html?.join("") || ""}`;
              const match = content.match(/https:\/\/[^\s"'<>]+oobCode=[a-zA-Z0-9_\-]+[^\s"'<>]*/i);
              if (match) { magicLink = match[0].replace(/&amp;/g, "&"); break; }
            }
            if (magicLink) break;
          }

          if (magicLink) {
            const userAuth = await verifyMagicLink(tempEmail, magicLink);
            const purchaseToken = master.purchaseToken || master.idToken;
            const applyRes = await applyPremium(userAuth.idToken, purchaseToken);

            saveGeneratedAccount(userAuth.email, {
              email: userAuth.email,
              isPro: true,
              password: tempPass,
              orderId: applyRes.orderId
            });
            results.push(`✅ \`${tempEmail}\` (Pass: ${tempPass})`);
          } else {
            results.push(`❌ Gagal: Timeout inbox (${tempEmail})`);
          }
        } catch (e) {
          results.push(`❌ Error: ${e.message}`);
        }
      }

      let resText = `⚡ *HASIL BATCH GENERATE (${results.length} AKUN)*\n\n`;
      resText += results.join("\n\n");
      return await m.reply(resText);
    }

    // MENU [1]: AUTO-GENERATE 1-KLIK
    if (cmdArg === "1") {
      if (!master || !master.isPro) {
        return await m.reply(
          `❌ *FITUR DIBLOKIR: AKUN MASTER PRO BELUM TERSEDIA!*\n\n` +
          `Status: ${masterBadge}\n\n` +
          `Fitur ini memerlukan Akun Master yang sudah memiliki lisensi Pro aktif untuk mengaktifkan akun lainnya.\n` +
          `Silakan daftarkan terlebih dahulu via menu:\n👉 *.alight 3*`
        );
      }

      await m.reply("🚀 *[1/4] Membuat email sementara & meminta Magic Link resmi dari Alight Creative...*");

      try {
        const domainRes = await axios.get("https://api.mail.tm/domains?page=1", { timeout: 10000 });
        const domain = domainRes.data?.["hydra:member"]?.[0]?.domain;
        if (!domain) throw new Error("Gagal mengambil domain Mail.tm");

        const rand = crypto.randomBytes(4).toString("hex");
        const tempEmail = `am_${rand}@${domain}`.toLowerCase();
        const tempPass = `Pass${rand}Aa1!`;

        await axios.post("https://api.mail.tm/accounts", { address: tempEmail, password: tempPass });
        const tRes = await axios.post("https://api.mail.tm/token", { address: tempEmail, password: tempPass });
        const token = tRes.data.token;

        await sendMagicLink(tempEmail);
        await m.reply(`⏳ *[2/4] Magic Link terkirim ke "${tempEmail}". Menunggu email masuk...*`);

        let magicLink = null;
        const start = Date.now();
        while (Date.now() - start < 70000) {
          await new Promise((r) => setTimeout(r, 4000));
          const inboxRes = await axios.get("https://api.mail.tm/messages", {
            headers: { Authorization: `Bearer ${token}` }
          });
          const msgs = inboxRes.data?.["hydra:member"] || [];

          for (const mItem of msgs) {
            const detail = await axios.get(`https://api.mail.tm/messages/${mItem.id}`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            const content = `${detail.data.subject} ${detail.data.text} ${detail.data.html?.join("") || ""}`;
            const match = content.match(/https:\/\/[^\s"'<>]+oobCode=[a-zA-Z0-9_\-]+[^\s"'<>]*/i);
            if (match) {
              magicLink = match[0].replace(/&amp;/g, "&");
              break;
            }
          }
          if (magicLink) break;
        }

        if (!magicLink) throw new Error("Timeout: Email konfirmasi tidak masuk dalam 70 detik.");

        await m.reply(`⚡ *[3/4] Link didapatkan! Menyuntikkan lisensi Pro ke akun baru...*`);
        const userAuth = await verifyMagicLink(tempEmail, magicLink);
        const purchaseToken = master.purchaseToken || master.idToken;
        const applyRes = await applyPremium(userAuth.idToken, purchaseToken);

        const expiry = new Date(Date.now() + 365 * 86400000).toISOString();
        saveGeneratedAccount(userAuth.email, {
          email: userAuth.email,
          localId: userAuth.localId,
          idToken: userAuth.idToken,
          refreshToken: userAuth.refreshToken,
          isPro: true,
          expiresAt: expiry,
          orderId: applyRes.orderId,
          password: tempPass
        });

        let outPro = `🎉 *AKUN ALIGHT MOTION PRO BERHASIL DIAKTIFKAN!* ⭐\n\n`;
        outPro += `📧 *Email Akun:* \`${userAuth.email}\`\n`;
        outPro += `🔑 *Pass Mail.tm:* \`${tempPass}\`\n`;
        outPro += `⭐ *Status:* PRO AKTIF\n`;
        outPro += `📅 *Masa Berlaku:* ${expiry}\n`;
        outPro += `🧾 *Order ID:* ${applyRes.orderId}\n\n`;
        outPro += `📱 *CARA LOGIN DI HP:*\n`;
        outPro += `1. Buka Alight Motion di HP -> Profil -> Masuk Email.\n`;
        outPro += `2. Masukkan email di atas.\n`;
        outPro += `3. Buka web https://mail.tm di browser HP & login akun di atas.\n`;
        outPro += `4. Buka email dari Alight Creative -> Klik tautan login. Aplikasi AM otomatis terbuka & PRO!`;
        return await m.reply(outPro);

      } catch (err) {
        return await m.reply(`❌ *Auto-Generate Gagal:* ${err.message}`);
      }
    }

    // MENU [2]: BUAT AKUN PRO MANUAL (INPUT EMAIL SENDIRI)
    if (cmdArg === "2") {
      const emailInput = args[1];

      if (!emailInput || !emailInput.includes("@")) {
        let pText = `--- *BUAT AKUN PRO MANUAL (INPUT EMAIL SENDIRI)* ---\n\n`;
        pText += `Masukkan Email yang ingin dijadikan Pro:\n`;
        pText += `👉 Ketik: *.alight 2 <email_anda>*\n`;
        pText += `_Contoh: .alight 2 myemail@gmail.com_`;
        return await m.reply(pText);
      }

      userInteractiveStates.set(sender, {
        step: "CONFIRM_MAGIC_LINK",
        type: "MANUAL_USER",
        email: emailInput.trim()
      });

      let qText = `--- *AKTIVASI PRO MANUAL* ---\n`;
      qText += `Email Target: \`${emailInput.trim()}\`\n\n`;
      qText += `Sudah punya link OOB di inbox email Anda?\n`;
      qText += `👉 Ketik: *.alight y* (Jika sudah ada link di inbox)\n`;
      qText += `👉 Ketik: *.alight n* (Jika minta bot kirimkan link verifikasi)`;
      return await m.reply(qText);
    }

    // MENU [3]: DAFTARKAN AKUN MASTER PRO
    if (cmdArg === "3") {
      const emailInput = args[1];

      if (!emailInput || !emailInput.includes("@")) {
        let pText = `--- *DAFTARKAN AKUN MASTER PRO (ALL-IN-ONE)* ---\n\n`;
        pText += `Masukkan Email Master Pro Anda:\n`;
        pText += `👉 Ketik: *.alight 3 <email_anda>*\n`;
        pText += `_Contoh: .alight 3 aionz@agencysq.store_`;
        return await m.reply(pText);
      }

      userInteractiveStates.set(sender, {
        step: "CONFIRM_MAGIC_LINK",
        type: "MASTER",
        email: emailInput.trim()
      });

      let qText = `--- *DAFTARKAN AKUN MASTER PRO (ALL-IN-ONE)* ---\n`;
      qText += `Email Master: \`${emailInput.trim()}\`\n\n`;
      qText += `Sudah punya link OOB di inbox email Anda?\n`;
      qText += `👉 Ketik: *.alight y* (Jika sudah ada di inbox)\n`;
      qText += `👉 Ketik: *.alight n* (Jika minta bot mengirimkan link verifikasi)`;
      return await m.reply(qText);
    }

    // MENU [4]: CEK STATUS MASTER LIVE
    if (cmdArg === "4") {
      if (!master) return await m.reply("❌ Belum ada Akun Master yang didaftarkan. Ketik *.alight 3*");
      await m.reply("⏳ *Memeriksa lisensi realtime Akun Master ke server...*");
      try {
        const lic = await getLicenseStatus(master.idToken);
        let sText = `👑 *INFORMASI LENGKAP AKUN MASTER PRO*\n\n`;
        sText += `📧 *Email:* \`${master.email}\`\n`;
        sText += `🆔 *UID:* ${master.localId}\n`;
        sText += `⭐ *Status Pro:* ${lic.isPro ? "[PRO AKTIF ⭐]" : "[EXPIRED / FREE]"}\n`;
        sText += `📅 *Expired:* ${lic.expiresAt || master.licenseExpires}\n`;
        sText += `🎁 *Benefits:* ${(lic.benefits || []).join(", ") || "All Pro Features"}`;
        return await m.reply(sText);
      } catch (e) {
        return await m.reply(`❌ *Gagal memuat status live:* ${e.message}`);
      }
    }

    // MENU [5]: RE-AKTIVASI AKUN TERSIMPAN (AUTO-RENEW)
    if (cmdArg === "5") {
      const genAccs = loadGeneratedAccounts();
      const list = Object.keys(genAccs);
      if (list.length === 0) return await m.reply("❌ Belum ada akun tersimpan di storage untuk di-renew.");

      const targetEmail = (args[1] || "").toLowerCase();
      if (!targetEmail) {
        let rText = `🔄 *MENU [5] RE-AKTIVASI AKUN (AUTO-RENEW)*\n\n`;
        rText += `Pilih salah satu email di bawah untuk di-renew:\n`;
        list.forEach((em, idx) => {
          rText += `${idx + 1}. \`${em}\` (${genAccs[em].isPro ? "PRO" : "EXPIRED"})\n`;
        });
        rText += `\n👉 Ketik: *.alight 5 <email>*\n_Atau ketik: *.alight 5 all* untuk perpanjang semua._`;
        return await m.reply(rText);
      }

      if (!master || !master.isPro) {
        return await m.reply("❌ Auto-Renew memerlukan Akun Master Pro yang aktif.");
      }

      await m.reply(`⏳ *Memperbarui lisensi akun...*`);
      const purchaseToken = master.purchaseToken || master.idToken;

      if (targetEmail === "all") {
        let okCount = 0;
        for (const em of list) {
          try {
            const acc = genAccs[em];
            const tokenRes = await refreshUserToken(acc.refreshToken);
            await applyPremium(tokenRes.idToken, purchaseToken);
            okCount++;
          } catch (_) {}
        }
        return await m.reply(`✅ *Batch Renew Selesai:* Berhasil memperbarui ${okCount} dari ${list.length} akun.`);
      }

      const acc = genAccs[targetEmail];
      if (!acc) return await m.reply(`❌ Akun "${targetEmail}" tidak ditemukan di database.`);

      try {
        const tokenRes = await refreshUserToken(acc.refreshToken);
        await applyPremium(tokenRes.idToken, purchaseToken);
        acc.idToken = tokenRes.idToken;
        acc.isPro = true;
        saveGeneratedAccount(targetEmail, acc);
        return await m.reply(`✅ *Sukses!* Akun \`${targetEmail}\` berhasil diperpanjang Pro!`);
      } catch (err) {
        return await m.reply(`❌ *Gagal Renew:* ${err.message}`);
      }
    }

    // MENU [6]: LIHAT DAFTAR AKUN TERSIMPAN
    if (cmdArg === "6") {
      const proAccs = readJsonSafe(PRO_ACCOUNTS_FILE, {});
      const genAccs = readJsonSafe(GENERATED_ACCOUNTS_FILE, {});

      const proList = Object.entries(proAccs);
      const genList = Object.entries(genAccs);

      let msg = `📋 *DAFTAR AKUN ALIGHT MOTION DI BOT*\n\n`;
      msg += `👑 *Akun Master / Pro Asli (${proList.length}):*\n`;
      if (proList.length === 0) {
        msg += `_(Belum ada akun master didaftarkan)_\n\n`;
      } else {
        proList.forEach(([em, d], i) => {
          msg += `${i + 1}. \`${em}\` - ${d.isPro ? "PRO ⭐" : "FREE"}\n`;
        });
        msg += `\n`;
      }

      msg += `⚡ *Akun Hasil Generate (${genList.length}):*\n`;
      if (genList.length === 0) {
        msg += `_(Belum ada akun hasil generate. Ketik .alight 1 untuk buat)_\n`;
      } else {
        genList.forEach(([em, d], i) => {
          msg += `${i + 1}. \`${em}\` - ${d.isPro ? "PRO ⭐" : "EXPIRED"}\n`;
        });
      }

      return await m.reply(msg);
    }

    // MENU [7]: CEK STATUS LISENSI AKUN TERSIMPAN / MANUAL
    if (cmdArg === "7") {
      const target = args[1];
      if (!target) {
        let help7 = `🔍 *MENU [7] CEK STATUS LISENSI PRO*\n\n`;
        help7 += `Ketik: *.alight 7 <email_tersimpan_atau_token>*\n`;
        help7 += `_Contoh: .alight 7 user@mail.com_`;
        return await m.reply(help7);
      }

      await m.reply(`⏳ *Memeriksa lisensi untuk:* \`${target}\`...`);
      try {
        let tokenToCheck = target;
        if (target.includes("@")) {
          const genAccs = loadGeneratedAccounts();
          const acc = genAccs[target.toLowerCase().trim()];
          if (!acc || !acc.refreshToken) return await m.reply(`❌ Akun "${target}" tidak ditemukan di database bot.`);
          const ref = await refreshUserToken(acc.refreshToken);
          tokenToCheck = ref.idToken;
        }

        const lic = await getLicenseStatus(tokenToCheck);
        let cText = `🔍 *STATUS LISENSI ALIGHT MOTION*\n\n`;
        cText += `📧 *Target:* \`${target}\`\n`;
        cText += `⭐ *Status:* ${lic.isPro ? "[PRO AKTIF ⭐]" : "[FREE / TIDAK AKTIF]"}\n`;
        cText += `📅 *Expired:* ${lic.expiresAt || "N/A"}\n`;
        cText += `🎁 *Benefits:* ${(lic.benefits || []).join(", ") || "Free"}`;
        return await m.reply(cText);
      } catch (err) {
        return await m.reply(`❌ *Gagal Cek Lisensi:* ${err.message}`);
      }
    }

    // ========================================================
    // TAMPILAN BANNER MENU UTAMA (JIKA HANYA KETIK .alight)
    // ========================================================
    let banner = `╭─── [ Alight Motion Suite v2.0 ] ───╮\n`;
    banner += `│ Official: OmnifyLabs\n`;
    banner += `╰────────────────────────────────────╯\n\n`;
    banner += `=== MENU INTERAKTIF ALIGHT MOTION PRO (OMNIFYLABS) ===\n`;
    banner += `Status Master : ${masterBadge}\n\n`;
    banner += `  [0] ⚡ Batch Generate (N Akun Sekaligus)\n`;
    banner += `  [1] 🚀 Auto-Generate Akun Pro Instan (1-Klik Terima Beres)\n`;
    banner += `  [2] ✍️ Buat Akun Pro Manual (Input Email Sendiri -> Tempel Link)\n`;
    banner += `  [3] 👑 Daftarkan Akun Master Pro (Input Email -> Tempel Link -> Selesai)\n`;
    banner += `  [4] 🔍 Cek Status & Lisensi Akun Master Pro (Live)\n`;
    banner += `  [5] 🔄 Re-Aktivasi Akun Tersimpan (Auto-Renew via Token)\n`;
    banner += `  [6] 📋 Lihat Daftar Akun Pro Tersimpan\n`;
    banner += `  [7] 🔍 Cek Status Lisensi Akun Tersimpan / Manual\n`;
    banner += `  [8] 📦 Download Preset XML & Audio (alight.link)\n\n`;
    banner += `👉 *Pilih Opsi:* Ketik *.alight [nomor]*\n`;
    banner += `_Contoh: .alight 8 https://alight.link/xxxx_ (Untuk download preset)\n`;
    banner += `_Contoh: .alight 6_ (Untuk cek daftar akun tersimpan)`;

    return await m.reply(banner);
  }
};