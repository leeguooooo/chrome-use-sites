import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// Repo rule: every pack documents itself in English and Chinese, and every
// change is logged in CHANGELOG.md. GitHub shows a folder's README.md when it
// is opened, so a pack without one is a blank page to anyone browsing.

const root = new URL('./', import.meta.url)
const packs = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
  .map((d) => d.name)
  .filter((name) => fs.readdirSync(new URL(name + '/', root)).some((f) => f.endsWith('.js') && !f.endsWith('.test.js')))

test('there are packs to check', () => {
  assert.ok(packs.length > 5, 'expected the adapter packs to be found')
})

for (const pack of packs) {
  test(`${pack}/ has README.md and README.zh.md that link to each other`, () => {
    for (const [file, other] of [['README.md', 'README.zh.md'], ['README.zh.md', 'README.md']]) {
      const url = new URL(`${pack}/${file}`, root)
      assert.ok(fs.existsSync(url), `${pack}/${file} is missing`)
      const text = fs.readFileSync(url, 'utf8')
      assert.ok(text.includes(`(${other})`), `${pack}/${file} should link to ${other}`)
    }
  })

  test(`${pack}/ READMEs mention every adapter in the pack`, () => {
    const adapters = fs
      .readdirSync(new URL(pack + '/', root))
      .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && !f.startsWith('_') && !f.endsWith('.mjs'))
      .map((f) => `${pack}/${f.slice(0, -3)}`)
    for (const file of ['README.md', 'README.zh.md']) {
      const text = fs.readFileSync(new URL(`${pack}/${file}`, root), 'utf8')
      for (const name of adapters) assert.ok(text.includes(name), `${pack}/${file} does not mention ${name}`)
    }
  })
}

test('root README has a Chinese version and both link to each other', () => {
  const en = fs.readFileSync(new URL('README.md', root), 'utf8')
  const zh = fs.readFileSync(new URL('README.zh.md', root), 'utf8')
  assert.ok(en.includes('(README.zh.md)'))
  assert.ok(zh.includes('(README.md)'))
})

test('CHANGELOG.md exists and every adapter appears in it', () => {
  const log = fs.readFileSync(new URL('CHANGELOG.md', root), 'utf8')
  assert.match(log, /^## \d{4}-\d{2}-\d{2}$/m, 'entries are dated headings')
  for (const pack of packs) {
    const adapters = fs
      .readdirSync(new URL(pack + '/', root))
      .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && !f.startsWith('_'))
    for (const f of adapters) {
      const cmd = f.slice(0, -3)
      assert.ok(log.includes(`${pack}/${cmd}`), `CHANGELOG.md never mentions ${pack}/${cmd}`)
    }
  }
})
