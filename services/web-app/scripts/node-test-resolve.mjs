// Loaded by `npm test` (node --import). Some dependencies (cmmn-moddle) ship
// ESM that Vite accepts but Node's ESM loader rejects:
//  - extension-less imports (relative, or package subpaths such as
//    "moddle/lib/ns"): retried with ".js";
//  - JSON imports without `with { type: 'json' }`: given that attribute.
import { registerHooks } from 'node:module'

function withJsonAttribute(result) {
  return result.url.endsWith('.json') && !result.importAttributes?.type
    ? { ...result, importAttributes: { ...result.importAttributes, type: 'json' } }
    : result
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return withJsonAttribute(nextResolve(specifier, context))
    } catch (err) {
      const isPath = /^\.\.?\//.test(specifier) || /^(@[^/]+\/)?[^/@.][^/]*\/.+/.test(specifier)
      if (err?.code === 'ERR_MODULE_NOT_FOUND' && isPath && !/\.(c|m)?js(on)?$/.test(specifier)) {
        return withJsonAttribute(nextResolve(`${specifier}.js`, context))
      }
      throw err
    }
  },
})
