import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = file => readFileSync(path.join(root, file), 'utf8')

function walk(dir) {
  return readdirSync(path.join(root, dir)).flatMap(name => {
    const relative = path.join(dir, name)
    return statSync(path.join(root, relative)).isDirectory() ? walk(relative) : [relative]
  })
}

test('index.html sets the title, favicon, theme colours and font preconnects', () => {
  const html = read('index.html')
  assert.match(html, /<title>ClubSpace<\/title>/)
  assert.match(html, /rel="icon"[^>]*href="\/favicon\.svg"/)
  assert.match(html, /name="theme-color" content="#f4f7fb" media="\(prefers-color-scheme: light\)"/)
  assert.match(html, /name="theme-color" content="#0e161e" media="\(prefers-color-scheme: dark\)"/)
  assert.match(html, /rel="preconnect" href="https:\/\/fonts\.googleapis\.com"/)
  assert.match(html, /rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin/)
  assert.match(html, /Bricolage\+Grotesque/)
  assert.match(html, /Lexend/)
  assert.match(html, /display=swap/)
})

test('the favicon is the ClubSpace mark', () => {
  assert.match(read('public/favicon.svg'), /aria-label="ClubSpace"/)
})

test('tokens cover light, dark and system-dark themes with the same names', () => {
  const tokens = read('src/styles/tokens.css')
  const theme = read('src/styles/theme.css')
  for (const name of ['--bg', '--surface', '--ink', '--lagoon', '--focus', '--shadow-sticker', '--space-4', '--radius-lg']) {
    assert.ok(tokens.includes(`${name}:`), `tokens.css defines ${name}`)
  }
  assert.match(theme, /prefers-color-scheme: dark/)
  assert.match(theme, /:root:not\(\[data-theme="light"\]\)/)
  const dark = [...tokens.match(/\[data-theme="dark"\] \{([\s\S]*?)\n\}/)[1].matchAll(/(--[\w-]+):/g)].map(m => m[1])
  for (const name of dark) assert.ok(theme.includes(`${name}:`), `theme.css mirrors ${name}`)
})

test('page and component stylesheets contain no literal colours', () => {
  const sheets = walk('src').filter(file => file.endsWith('.css') && !file.endsWith('tokens.css') && !file.endsWith('theme.css'))
  assert.ok(sheets.length >= 2)
  for (const sheet of sheets) {
    const css = read(sheet).replace(/\/\*[\s\S]*?\*\//g, '').replace(/rgba\(255,255,255,\.\d+\)/g, '') // translucent white sheen on cover art
    const found = css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\b(white|black)\b(?!-)/g)
    assert.equal(found, null, `${sheet} has literal colours: ${found}`)
  }
})
