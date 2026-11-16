import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const tokens = readFileSync(fileURLToPath(new URL('../src/styles/tokens.css', import.meta.url)), 'utf8')

function block(selector) {
  const match = tokens.match(new RegExp(`${selector.replace(/[[\]"]/g, '\\$&')}\\s*\\{([\\s\\S]*?)\\n\\}`))
  return Object.fromEntries([...match[1].matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1], m[2]]))
}
const light = block(':root, [data-theme="light"]')
const dark = { ...light, ...block('[data-theme="dark"]') }

const channel = value => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const luminance = hex => { const [r, g, b] = [1, 3, 5].map(i => channel(parseInt(hex.slice(i, i + 2), 16))); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

// Text pairs (>= 4.5:1) as the design system uses them.
const TEXT = [
  ['--ink', '--bg'], ['--ink', '--surface'], ['--ink', '--surface-sunk'], ['--ink-muted', '--bg'], ['--ink-muted', '--surface'],
  ['--ink-muted', '--surface-sunk'], ['--on-lagoon', '--lagoon'], ['--lagoon', '--surface'], ['--lagoon', '--lagoon-soft'],
  ['--on-pop', '--sun'], ['--on-pop', '--coral'], ['--on-pop', '--mint'], ['--mint-ink', '--mint-soft'], ['--sun-ink', '--sun-soft'],
  ['--coral-ink', '--coral-soft'], ['--danger', '--danger-soft'], ['--danger', '--surface'], ['--bg', '--ink'],
]
// Focus ring and component outlines against the page (>= 3:1).
const MARKS = [['--focus', '--bg'], ['--focus', '--surface'], ['--outline', '--bg']]

for (const [name, theme] of [['light', light], ['dark', dark]]) {
  test(`${name} theme: text pairs reach 4.5:1`, () => {
    for (const [fg, bg] of TEXT) {
      const value = ratio(theme[fg], theme[bg])
      assert.ok(value >= 4.5, `${fg} on ${bg} is ${value.toFixed(2)}:1`)
    }
  })
  test(`${name} theme: focus ring and outlines reach 3:1`, () => {
    for (const [fg, bg] of MARKS) {
      const value = ratio(theme[fg], theme[bg])
      assert.ok(value >= 3, `${fg} on ${bg} is ${value.toFixed(2)}:1`)
    }
  })
}
