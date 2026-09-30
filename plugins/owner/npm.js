// plugins/owner/npm.js
import { spawn } from 'child_process'
import path from 'path'
import { reloadGlobalPlugins } from '../../lib/loadPlugins.js'
const PLUGINS_ROOT = path.resolve(process.cwd(), 'plugins')

// Deteksi binary npm (Linux/Pterodactyl pakai 'npm', Windows pakai 'npm.cmd')
const NPM_CMD = process.platform === 'win32' ? 'npm.cmd' : 'npm'

/**
 * Menjalankan command npm menggunakan spawn (aman dari injection)
 */
function runNpm(args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(NPM_CMD, args, {
      cwd: process.cwd(),
      shell: false
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', data => {
      stdout += data.toString()
    })

    child.stderr.on('data', data => {
      stderr += data.toString()
    })

    // Timeout jika proses lebih dari 3 menit
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`Proses timeout setelah ${timeoutMs / 1000} detik.`))
    }, timeoutMs)

    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new Error(stderr || stdout || `Exited with code ${code}`))
      }
    })

    child.on('error', err => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

export default {
  command: 'npm',
  alias: ['npmi', 'npmun', 'install', 'uninstall', 'package'],
  category: 'owner',
  description: `Menginstall atau meng-uninstall package NPM langsung dari chat.

*Contoh Penggunaan:*
> .npm i qrcode
> .npmi canvas axios
> .npm un lodash
> .install moment`,
  help: '<i/un> <package_name>',
  onlyOwner: true,

  async execute(m, { args = [], sock }) {
    if (!args.length) {
      return m.reply(
        `📦 *NPM Manager (Owner Only)*\n\n` +
        `*Format Penggunaan:*\n` +
        `> \`${m.prefix}npm i <nama package>\` (Install)\n` +
        `> \`${m.prefix}npm un <nama package>\` (Uninstall)\n\n` +
        `*Contoh:*\n` +
        `> \`${m.prefix}npm i qrcode\`\n` +
        `> \`${m.prefix}npmi chalk canvas\`\n` +
        `> \`${m.prefix}npm un lodash\``
      )
    }

    let action = 'install'
    let packages = []

    const firstArg = args[0].toLowerCase()

    // Cek aksi dari argumen atau alias command
    if (['i', 'install', 'add'].includes(firstArg)) {
      action = 'install'
      packages = args.slice(1)
    } else if (['un', 'uninstall', 'remove', 'rm'].includes(firstArg) || m.command === 'uninstall' || m.command === 'npmun') {
      action = 'uninstall'
      packages = (firstArg === 'un' || firstArg === 'uninstall' || firstArg === 'remove' || firstArg === 'rm')
        ? args.slice(1)
        : args
    } else if (m.command === 'install' || m.command === 'npmi') {
      action = 'install'
      packages = args
    } else {
      // Default jika user langsung ketik: .npm qrcode
      action = 'install'
      packages = args
    }

    // Bersihkan argumen kosong
    packages = packages.map(p => p.trim()).filter(Boolean)

    if (!packages.length) {
      return m.reply(`❌ Masukkan minimal satu nama package NPM yang ingin di-${action}.`)
    }

    // Validasi karakter nama package (mencegah karakter aneh)
    const invalidPkg = packages.find(pkg => !/^[a-zA-Z0-9@_./~^><=+-]+$/.test(pkg))
    if (invalidPkg) {
      return m.reply(`❌ Karakter nama package tidak valid: \`${invalidPkg}\``)
    }

    // Reaksi status & pesan tunggu
    if (sock?.sendReact) {
      await sock.sendReact(m.jid, '⏳', m.id).catch(() => {})
    }

    const waitMsg = await m.reply(
      `⏳ *Sedang memproses npm ${action}...*\n\n` +
      `• Package: \`${packages.join(', ')}\`\n` +
      `_Mohon tunggu, proses download & build butuh beberapa saat._`
    )

    try {
      const npmArgs = action === 'install'
        ? ['install', '--save', ...packages]
        : ['uninstall', '--save', ...packages]

      // Eksekusi npm di background
      const { stdout } = await runNpm(npmArgs)

      // Ringkas log output agar tidak terlalu panjang di WA
      const cleanLog = stdout
        .split('\n')
        .filter(line => line.trim())
        .slice(-6)
        .join('\n')

      let reloadMsg = ''
      try {
        // Otomatis reload plugins agar package langsung bisa dipakai
        const result = await reloadGlobalPlugins(PLUGINS_ROOT)
        reloadMsg = `\n🔄 *Auto-Reload Plugins:* Berhasil (Loaded: ${result.loaded || 'OK'})`
      } catch (rErr) {
        reloadMsg = `\n⚠️ *Auto-Reload Plugins Gagal:* ${rErr.message}`
      }

      if (sock?.sendReact) {
        await sock.sendReact(m.jid, '✅', m.id).catch(() => {})
      }

      return m.reply(
        `✅ *NPM ${action.toUpperCase()} BERHASIL!*\n\n` +
        `• *Package:* \`${packages.join(', ')}\`${reloadMsg}\n\n` +
        `*Log:* \n\`\`\`${cleanLog || 'Selesai tanpa peringatan.'}\`\`\``
      )

    } catch (error) {
      if (sock?.sendReact) {
        await sock.sendReact(m.jid, '❌', m.id).catch(() => {})
      }

      return m.reply(
        `❌ *NPM ${action.toUpperCase()} GAGAL!*\n\n` +
        `• Package: \`${packages.join(', ')}\`\n` +
        `• Error: \n\`\`\`${error.message.slice(0, 1000)}\`\`\``
      )
    }
  }
}