import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const FORBIDDEN = ['Admin login', 'Log in', 'Logging in', 'Log out', 'Manage users', 'Cancel', 'Confirm', 'Working…',
  'Close', 'Menu', 'Save feature', 'Saving…', 'Delete feature', 'Edit existing', 'Exit edit', 'Add a feature',
  'Select a layer', 'Drawing…', 'New user', 'Edit user', 'Full name', 'Loading users', 'Back to map', 'Deactivate',
  'Activate', 'Inactive', 'Something went wrong', 'Invalid email or password', 'Cannot reach the server',
  'Too many attempts', 'Email already in use', 'You do not have permission', "Couldn't load users",
  'Could not delete', 'Please try again', 'This cannot be undone']

const SRC = join(__dirname, '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (full === __dirname) continue
      walk(full, out)
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

// Whole string literals ('…', "…", `…`) and JSX text (>…<); identifiers never match.
// Comments are matched first so an apostrophe inside one cannot open a bogus string.
const LITERAL = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|>\s*([^<>{};=]*?[\p{L}][^<>{};=]*?)\s*</gu

describe('interface copy', () => {
  it('has no English strings from the copy table left in the source', () => {
    const hits: string[] = []
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(LITERAL)) {
        if (m[0].startsWith('//') || m[0].startsWith('/*')) continue
        // Module specifiers (from './ConfirmDialog') are identifiers, not copy.
        if (/(?:from|import)\s*\(?\s*$/.test(text.slice(Math.max(0, m.index - 12), m.index))) continue
        const body = m[1] ?? m[0].slice(1, -1)
        for (const word of FORBIDDEN) {
          if (body.includes(word)) hits.push(`${relative(SRC, file)}: ${m[0].trim()}`)
        }
      }
    }
    expect([...new Set(hits)]).toEqual([])
  })
})
