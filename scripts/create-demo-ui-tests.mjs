import fs from 'node:fs'
// Reuse the existing dependency-free CDP harness; do not replace the working legacy checks.
let source=fs.readFileSync('tests/mobile-ui.mjs','utf8')
source=source.replace("'ui-review'","'resume-review'").replace("const fixture = readFileSync(join(root, 'tests', 'fixtures', 'supabase.js'), 'utf8')",'')
source=source.replace("import assert from 'node:assert/strict'", "import assert from 'node:assert/strict'\nimport { esEntornoDemoPermitido } from '../src/lib/demo/environment.js'")
source=source.replace("assert.equal(new URL(base).hostname, '127.0.0.1', 'Use a local server for these tests')", "assert.ok(new URL(base).protocol === 'http:' && esEntornoDemoPermitido(new URL(base)), 'Use HTTP localhost or a private LAN server for these tests')")
source=source.replace("const artifacts = join(root, 'artifacts', 'resume-review')", "const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'resume-review')")
source=source.replace(/\} else if \(url.pathname === '\/src\/lib\/supabase.js'\) \{[\s\S]*?\} else await send\('Fetch.continueRequest'/,"} else await send('Fetch.continueRequest'")
source=source.replace("assert.equal(measurements.themeButtons, 1)","assert.ok(measurements.themeButtons >= 1)")
const start=source.indexOf("  await send('Page.enable')")
const end=source.indexOf('} catch (error) {\n  await writeFile',start)
const body=fs.readFileSync('tests/demo-ui-cases.txt','utf8')
source=source.slice(0,start)+body+'\n'+source.slice(end)
fs.writeFileSync('tests/demo-ui.mjs',source)
