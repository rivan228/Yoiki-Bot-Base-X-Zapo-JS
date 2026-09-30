// plugins/tools/qris.js
import QRCode from 'qrcode'
const RAW_QRIS_STRING =
  '00020101021126570011ID.DANA.WWW011893600915372366550202097236655020303UMI51440014ID.CO.QRIS.WWW0215ID10243371080120303UMI5204594553033605802ID5910NARR STORE6010Kota Medan61052011163046B51'

function crc16ccittFalse(str) {
  let crc = 0xffff

  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8

    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000
        ? (crc << 1) ^ 0x1021
        : crc << 1

      crc &= 0xffff
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, '0')
}

function parseTLV(payload) {
  const result = []
  let index = 0

  while (index + 4 <= payload.length) {
    const id = payload.slice(index, index + 2)
    const length = parseInt(
      payload.slice(index + 2, index + 4),
      10
    )

    if (!Number.isFinite(length)) break

    const valueStart = index + 4
    const valueEnd = valueStart + length

    if (valueEnd > payload.length) break

    result.push({
      id,
      val: payload.slice(valueStart, valueEnd)
    })

    index = valueEnd
  }

  return result
}

function buildTLV(items) {
  return items
    .map(({ id, val }) => {
      const value = String(val)

      return (
        id +
        String(value.length).padStart(2, '0') +
        value
      )
    })
    .join('')
}

function setTag(items, id, value) {
  const index = items.findIndex(item => item.id === id)

  if (index === -1) {
    items.push({ id, val: value })
  } else {
    items[index].val = value
  }
}

function removeTag(items, id) {
  const index = items.findIndex(item => item.id === id)

  if (index !== -1) {
    items.splice(index, 1)
  }
}

// PENTING: tag TLV wajib urut naik berdasarkan ID (spesifikasi EMVCo).
// Tanpa ini, tag 54 (nominal) yang baru ditambahkan lewat push() akan
// nyangkut di posisi terakhir dan bikin payload dianggap invalid oleh
// sebagian scanner/payment app.
function sortTags(items) {
  return [...items].sort((a, b) => Number(a.id) - Number(b.id))
}

function makeQrisDynamic(base, amount) {
  const clean = String(base || '').trim()

  if (!clean.startsWith('000201')) {
    throw new Error('Format QRIS tidak valid')
  }

  const numericAmount = Number(amount)

  if (
    !Number.isFinite(numericAmount) ||
    numericAmount <= 0
  ) {
    throw new Error('Nominal tidak valid')
  }

  // Buang CRC lama
  const withoutCrc = clean.replace(
    /6304[0-9A-Fa-f]{4}$/,
    ''
  )

  let items = parseTLV(withoutCrc)

  if (!items.length) {
    throw new Error('QRIS gagal dibaca')
  }

  removeTag(items, '63')

  // Set ke QRIS Dinamis
  setTag(items, '01', '12')

  // Set Nominal
  setTag(items, '54', String(numericAmount))

  // Urutkan ulang tag sebelum di-build
  items = sortTags(items)

  const body = buildTLV(items)

  // Hitung ulang CRC16
  const crcInput = `${body}6304`
  const crc = crc16ccittFalse(crcInput)

  return `${crcInput}${crc}`
}

function formatRupiah(amount) {
  return Number(amount).toLocaleString('id-ID')
}

export default {
  command: 'qris',

  alias: [
    'pay',
    'bayar'
  ],

  category: 'tools',

  description: `Membuat QRIS dynamic berdasarkan nominal.

Contoh:
.qris 5000
.pay 10000
.bayar 25000`,

  async execute(m, { sock, args = [] }) {
    try {
      const rawInput =
        args[0] ||
        m.text?.trim().split(/\s+/)[1] ||
        ''

      const nominal = String(rawInput).replace(/[^0-9]/g, '')

      if (!nominal) {
        return m.reply(
          `❌ Masukkan nominal.\n\n` +
          `Contoh:\n` +
          `> ${m.prefix || '.'}qris 5000`
        )
      }

      const amount = Number(nominal)

      if (!Number.isFinite(amount) || amount <= 0) {
        return m.reply('❌ Nominal tidak valid.')
      }

      const payload = makeQrisDynamic(RAW_QRIS_STRING, amount)

      // Generate PNG Buffer langsung di RAM (tanpa koneksi internet)
      const qrBuffer = await QRCode.toBuffer(payload, {
        type: 'png',
        width: 800,
        margin: 2
      })

      const caption =
        `💳 *QRIS PAYMENT*\n\n` +
        `• *Merchant:* NARR STORE\n` +
        `• *Nominal:* Rp${formatRupiah(amount)}\n` +
        `• *Lokasi:* Kota Medan\n` +
        `• *Kadaluarsa:* 15 Menit\n\n` +
        `_Scan QRIS di atas untuk melakukan pembayaran._`

      return await m.reply({
        type: 'image',
        media: qrBuffer,
        mimetype: 'image/png',
        caption
      })

    } catch (error) {
      console.error('[QRIS ERROR]', error)

      return m.reply(
        `❌ Gagal membuat QRIS.\n\n` +
        `Error: ${error.message}`
      )
    }
  }
}