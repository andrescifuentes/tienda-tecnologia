// Node-only support for Vite asset imports in the existing domain/PDF suites.
// Does not replace modules or access the network.
export async function load(url, context, nextLoad) {
  if (/\.(png|jpe?g|webp|svg)$/.test(new URL(url).pathname)) return {
    format:'module', shortCircuit:true, source:'export default '+JSON.stringify(url),
  }
  return nextLoad(url, context)
}
