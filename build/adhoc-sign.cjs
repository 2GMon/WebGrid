// Ad-hoc sign the packed macOS app. With `identity: null` electron-builder
// leaves only Electron's linker signature, which seals no resources, so a
// downloaded copy is reported as "damaged" instead of "cannot be verified".
// electron-builder 25 has no ad-hoc option of its own: `identity: '-'` is
// matched against keychain certificates rather than passed to codesign.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
}
