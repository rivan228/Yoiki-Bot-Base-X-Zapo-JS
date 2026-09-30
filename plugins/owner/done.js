// plugins/owner/done.js
import fs from "fs"
import path from "path"
const TESTI_CHANNEL = "120363408730913091@newsletter"
const TRX_FILE = path.join(process.cwd(), "database", "trx_counter.json")

function getNextTrxId() {
  let lastTrx = 19 // Dimulai dari 19 agar urutan berikutnya #20

  try {
    if (fs.existsSync(TRX_FILE)) {
      const data = JSON.parse(fs.readFileSync(TRX_FILE, "utf8"))
      if (typeof data.lastTrx === "number") {
        lastTrx = data.lastTrx
      }
    }
  } catch (e) {
    console.error("Gagal membaca counter TRX:", e)
  }

  const nextTrx = lastTrx + 1

  try {
    const dir = path.dirname(TRX_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    fs.writeFileSync(
      TRX_FILE,
      JSON.stringify({ lastTrx: nextTrx }, null, 2)
    )
  } catch (e) {
    console.error("Gagal menyimpan counter TRX:", e)
  }

  return `#${nextTrx}`
}

// Parser input berbasis tanda koma (,)
function parseInput(fullText) {
  const parts = fullText.split(",").map(item => item.trim())
  
  const produk = parts[0] || ""
  const hargaRaw = parts[1] || ""
  const pembayaran = parts[2] || "-"

  let harga = hargaRaw

  // Otomatis ubah angka jadi Rp. 5.000
  if (hargaRaw) {
    const num = parseInt(hargaRaw.replace(/[^\d]/g, ""), 10)
    if (!isNaN(num)) {
      harga = "Rp. " + num.toLocaleString("id-ID")
    }
  }

  return {
    produk,
    harga,
    pembayaran: pembayaran.toUpperCase()
  }
}

// Konversi aman Uint8Array / Stream Zapo-JS ke Buffer Node.js
async function toBuffer(input) {
  if (!input) return null
  if (Buffer.isBuffer(input)) return input

  if (input instanceof Uint8Array || ArrayBuffer.isView(input)) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  }
  if (input instanceof ArrayBuffer) {
    return Buffer.from(input)
  }

  if (typeof input[Symbol.asyncIterator] === "function") {
    const chunks = []
    for await (const chunk of input) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }

  return null
}

async function downloadImageZapo(m, sock) {
  const target = m.quoted || m

  if (typeof target.download === "function") {
    try {
      const res = await target.download()
      const buf = await toBuffer(res)
      if (buf && buf.length > 0) return buf
    } catch (e) {
      console.log("[Zapo-JS] target.download() gagal:", e.message)
    }
  }

  if (typeof m.download === "function") {
    try {
      const res = await m.download()
      const buf = await toBuffer(res)
      if (buf && buf.length > 0) return buf
    } catch (e) {
      console.log("[Zapo-JS] m.download() gagal:", e.message)
    }
  }

  const payloads = [
    target.raw,
    target.event,
    target._raw,
    target.fakeObj,
    target.msg,
    target
  ].filter(Boolean)

  if (sock?.message && typeof sock.message.download === "function") {
    for (const p of payloads) {
      try {
        const res = await sock.message.download(p)
        const buf = await toBuffer(res)
        if (buf && buf.length > 0) return buf
      } catch (_) {}
    }
  }

  if (sock?.message && typeof sock.message.downloadBytes === "function") {
    for (const p of payloads) {
      try {
        const res = await sock.message.downloadBytes(p)
        const buf = await toBuffer(res)
        if (buf && buf.length > 0) return buf
      } catch (_) {}
    }
  }

  const direct = target.media || target.buffer || target.msg?.media
  if (direct) {
    const buf = await toBuffer(direct)
    if (buf && buf.length > 0) return buf
  }

  if (sock && typeof sock.downloadMediaMessage === "function") {
    try {
      const res = await sock.downloadMediaMessage(target.fakeObj || target)
      const buf = await toBuffer(res)
      if (buf && buf.length > 0) return buf
    } catch (e) {
      console.log("[Zapo-JS] sock.downloadMediaMessage gagal:", e.message)
    }
  }

  return null
}

export default {
  command: "done",
  alias: ["testi", "testimoni"],
  category: "store",
  description: "Kirim bukti transaksi ke channel testimoni",

  async execute(m, context) {
    const { sock, args, text } = context

    if (!sock) {
      return m.reply("❌ Connection socket tidak tersedia.")
    }

    // Menggabungkan teks argumen jika ada
    const fullText = (text || (args ? args.join(" ") : "")).trim()
    const parts = fullText.split(",").map(v => v.trim())

    // Validasi input pemisah koma: minimal produk, harga, pembayaran
    if (!fullText || parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
      return m.reply(
        "⚠️ *Format penulisan salah!*\n\n" +
        "Gunakan pemisah tanda koma (`,`):\n" +
        "*.done <produk>,<harga>,<pembayaran>*\n\n" +
        "*Contoh:*\n" +
        ".done nokos wa indo,5000,qris\n" +
        ".done sewa bot 30 hari,25000,dana"
      )
    }

    const target = m.quoted || m

    let detectedMime = target.mimetype || target.msg?.mimetype || target.mediaType || "image/jpeg"
    if (!detectedMime.startsWith("image/")) {
      detectedMime = "image/jpeg"
    }

    const isImage =
      detectedMime.startsWith("image") ||
      target.type === "image" ||
      target.mtype === "imageMessage" ||
      Boolean(target.message?.imageMessage)

    if (!isImage) {
      return m.reply(
        "📸 *FORMAT TESTIMONI*\n" +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        "Kirim / reply *gambar* dengan teks:\n" +
        ".done <produk>,<harga>,<pembayaran>\n\n" +
        "*Contoh:*\n" +
        ".done nokos wa indo,5000,qris\n\n" +
        "📌 Gambar + pemisah koma wajib!\n" +
        "━━━━━━━━━━━━━━━━━━━━"
      )
    }

    await m.reply("⏳ Memproses testimoni...")

    const mediaBuffer = await downloadImageZapo(m, sock)

    if (!mediaBuffer) {
      return m.reply(
        "❌ Gagal mengambil buffer gambar dari WhatsApp.\n\n" +
        "Saran: Reply pesan gambarnya lalu ketik:\n" +
        `.done ${fullText}`
      )
    }

    const parsed = parseInput(fullText)

    const now = new Date().toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    })

    const trxId = getNextTrxId()

    const testiCaption =
      "『 Transaction Successful 』\n" +
      "━━━━━━━━━━━━━━━\n" +
      `📦 Produk : ${parsed.produk}\n` +
      `💰 Harga : ${parsed.harga}\n` +
      `💳 Pembayaran : ${parsed.pembayaran}\n` +
      `🕒 Waktu : ${now} WIB\n` +
      `🧾 Nomor TRX : ${trxId}\n` +
      "✅ Status : Tercatat & Selesai!\n" +
      "━━━━━━━━━━━━━━━\n\n" +
      "👤 Contact GustodX :\n" +
      "wa.me/1panns_\n" +
      "t.me/gustodxx\n\n" +
      "Grup GustodX Marketplace :\n" +
      "https://chat.whatsapp.com/J9vgUDrTT7pGyTBTgCJ60M\n\n" +
      "Channel Testimoni :\n" +
      "https://whatsapp.com/channel/0029VbCpOyD0G0XfVYCbrU1H\n" +
      "Channel Information :\n" +
      "https://whatsapp.com/channel/0029VbCi8Ch1HspyNQd4PB2A\n" +
      "━━━━━━━━━━━━━━━\n" +
      "✨ Terima Kasih Telah Bertransaksi ✨"

    try {
      await sock.message.send(
        TESTI_CHANNEL,
        {
          type: "image",
          media: mediaBuffer,
          mimetype: detectedMime,
          caption: testiCaption
        },
        {
          customNodes: [
            {
              tag: "newsletter_data",
              attrs: { jid: TESTI_CHANNEL },
              content: []
            }
          ]
        }
      )

      return m.reply(
        "✅ *Testimoni berhasil dikirim!*\n\n" +
        "📸 Bukti transaksi sudah diteruskan ke channel.\n" +
        `🧾 Nomor TRX: *${trxId}*\n\n` +
        "Terima kasih atas kepercayaannya! 🙏"
      )
    } catch (e) {
      console.error("[Testi] Error kirim ke channel:", e)

      return m.reply(
        "❌ *Gagal mengirim ke channel!*\n\n" +
        `Error: ${e?.message || e}`
      )
    }
  }
}