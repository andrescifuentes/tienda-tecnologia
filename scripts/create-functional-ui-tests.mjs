import fs from 'node:fs'
const harness=fs.readFileSync('tests/demo-ui.mjs','utf8')
const start=harness.indexOf("  await send('Page.enable')"),end=harness.indexOf('} catch (error) {\n  await writeFile',start)
if(start<0||end<0)throw Error('Harness boundaries missing')
const prefix=harness.slice(0,start).replace("'resume-review'","'functional-ui'").replace('    throw new Error(`Timed out waiting for ${expression}`)', '    await screenshot("failure"); await writeFile(join(artifacts,"failure.json"),JSON.stringify(await evaluate("({alerts:[...document.querySelectorAll(\\\"[role=alert]\\\")].map(e=>e.textContent),body:document.body.innerText})"),null,2));\n    throw new Error(`Timed out waiting for ${expression}`)')
fs.writeFileSync('tests/functional-ui.mjs',prefix+fs.readFileSync('tests/functional-ui-cases.txt','utf8')+'\n'+harness.slice(end))
