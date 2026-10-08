import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'

// Run browser suites sequentially: each creates and removes its own temporary profile.
// No user browser data, production account, remote service, or real camera is used.
const suites = [
  ['tests/demo-store.mjs', {}],
  ['tests/demo-environment.mjs', {}],
  ['tests/functional-store.mjs', {}],
  ['tests/demo-ui.mjs', { UI_ARTIFACTS: 'functional-regression' }],
  ['tests/visual-layout.mjs', {}],
  ['tests/mobile-ui.mjs', {}],
  ['tests/iphone-themes.mjs', {}],
  ['tests/iphone-forms.mjs', {}],
  ['tests/functional-ui.mjs', { UI_ARTIFACTS: 'functional-ui' }],
]
if (process.env.UI_LAN_BASE_URL) suites.push(['tests/functional-ui.mjs', {
  UI_BASE_URL: process.env.UI_LAN_BASE_URL, UI_ARTIFACTS: 'functional-lan',
}])
const from = process.argv.find(arg => arg.startsWith('--from='))?.slice(7)
if (from) {
  const index = suites.findIndex(([file]) => file === from)
  if (index < 0) throw new Error('Unknown validation suite: ' + from)
  suites.splice(0, index)
}

const results = []
await mkdir('artifacts/functional-validation', { recursive: true })
for (const [file, environment] of suites) {
  console.log(`RUN ${file}${environment.UI_BASE_URL ? ' ' + environment.UI_BASE_URL : ''}`)
  const started = Date.now()
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], {
      env: { ...process.env, ...environment }, windowsHide: true, stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('exit', resolve)
  })
  results.push({ file, origin: environment.UI_BASE_URL || 'localhost', status: code === 0 ? 'PASS' : 'FAIL', seconds: Math.round((Date.now() - started) / 1000) })
  await writeFile('artifacts/functional-validation/results.json', JSON.stringify({ status: code === 0 ? 'RUNNING' : 'FAIL', results }, null, 2) + '\n')
  if (code !== 0) { process.exitCode = 1; break }
}
if (!process.exitCode) await writeFile('artifacts/functional-validation/results.json', JSON.stringify({ status: 'PASS', results }, null, 2) + '\n')
