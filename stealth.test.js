import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// Stealth first (AGENTS.md): a write adapter acts on the user's real account,
// so its input must be the real input chrome-use sends through args.ui. An
// adapter's own el.click(), dispatchEvent or execCommand is isTrusted: false,
// which a site can tell apart from a person; it may stay only as the fallback
// for older chrome-use or a failed ui call.

const root = new URL('./', import.meta.url)
const adapters = fs.readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
  .flatMap((d) => fs.readdirSync(new URL(d.name + '/', root))
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && !f.startsWith('_'))
    .map((f) => d.name + '/' + f))

const SYNTHETIC = /\.click\(\)|dispatchEvent\(|execCommand\(/

test('every write adapter that drives the page does it through args.ui', () => {
  const offenders = []
  for (const file of adapters) {
    const src = fs.readFileSync(new URL(file, root), 'utf8')
    if (!/"readOnly":\s*false/.test(src)) continue
    if (SYNTHETIC.test(src) && !/args\.ui|\bUI\.(click|type|typeHere|press|scroll|hover)\(/.test(src)) offenders.push(file)
  }
  assert.deepEqual(offenders, [], 'use args.ui for clicks and typing, keep synthetic events only as the fallback (AGENTS.md, Stealth first)')
})

test('no adapter leaves a named global on window', () => {
  const offenders = adapters.filter((file) => {
    const src = fs.readFileSync(new URL(file, root), 'utf8')
    return /\b(window|W|globalThis)\.__\w+\s*=|\b(window|globalThis)\[['"]__/.test(src)
  })
  assert.deepEqual(offenders, [], 'keep state in the adapter function, not on window (AGENTS.md, Stealth first)')
})
