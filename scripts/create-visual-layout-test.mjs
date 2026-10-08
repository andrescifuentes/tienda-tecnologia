import fs from 'node:fs'
const harness=fs.readFileSync('tests/demo-ui.mjs','utf8')
const start=harness.indexOf("  await send('Page.enable')")
const end=harness.indexOf('} catch (error) {\n  await writeFile',start)
const body=`
  await send('Page.enable');await send('Runtime.enable');await send('Log.enable')
  await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]})
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await send('Page.navigate',{url:base+'/login'});await waitFor("!!document.querySelector('.login-form')")
  await evaluate("document.querySelector('.login-form button.btn').click()")
  await waitFor("!!document.querySelector('.stat-card')")
  const routes=[['/','.stat-card'],['/inventario','.product-card'],['/vender','.sale-product'],['/facturas','.invoice-card'],['/clientes','.row'],['/proveedores','.row'],['/empleados','.row'],['/finanzas','.row'],['/garantias','.row'],['/mas','.menu-row'],['/configuracion','.card']]
  for(const[width,height]of [[320,568],[360,740],[390,844],[430,932]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true})
    for(const[path,selector]of routes){await send('Page.navigate',{url:base+path});await waitFor("!!document.querySelector('.nav') && document.readyState==='complete'");await waitFor('!!document.querySelector('+JSON.stringify(selector)+')');await evaluate('document.fonts.ready.then(()=>true)');await delay(200);const name=width+'-'+(path==='/'?'inicio':path.slice(1));await geometry(name,width,height);await screenshot(name);if(path==='/facturas')assert.ok(await evaluate("getComputedStyle(document.querySelector('.invoice-card'),'::after').content.includes('›')"));if(path==='/inventario')assert.ok(await evaluate("getComputedStyle(document.querySelector('.product-card .text-right'),'::after').content.includes('›')"))}
  }
  assert.deepEqual(externalRequests,[]);assert.deepEqual(browserErrors,[])
  await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'PASS',cases:results.length,results,externalRequests,browserErrors},null,2))
  console.log(JSON.stringify({status:'PASS',cases:results.length,artifacts}));await send('Browser.close').catch(()=>{})
`
fs.writeFileSync('tests/visual-layout.mjs',harness.slice(0,start).replace("'resume-review'","'visual-layout'")+body+'\n'+harness.slice(end))
