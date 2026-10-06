import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
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

/**
 * Forbidden strings found in the string literals, template literals and JSX text of one source
 * file. Read from the TypeScript syntax tree, so comments, identifiers and module specifiers
 * never match and JSX text counts however many `{…}` expressions surround it.
 */
function findForbidden(text: string): string[] {
  const file = ts.createSourceFile('x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const hits: string[] = []
  const isModuleSpecifier = (node: ts.Node): boolean => {
    const parent = node.parent
    if (!parent) return false
    if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return parent.moduleSpecifier === node
    if (ts.isExternalModuleReference(parent)) return true
    if (ts.isLiteralTypeNode(parent) && parent.parent && ts.isImportTypeNode(parent.parent)) return true
    return ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword
  }
  const visit = (node: ts.Node): void => {
    const isText =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)
    if (isText && !isModuleSpecifier(node) && FORBIDDEN.some((word) => node.text.includes(word))) {
      hits.push(node.text.trim())
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return hits
}

describe('findForbidden', () => {
  it.each([
    ['plain JSX text', '<p>Cancel</p>'],
    ['JSX text before an expression', '<p>Please try again {x}</p>'],
    ['JSX text after an expression', '<p>{x} Please try again</p>'],
    ['JSX text between expressions', '<p>{a} Cancel: {n} items</p>'],
    ['JSX text then an expression', '<p>Cancel: {n} items</p>'],
    ['a string literal', "const a = 'Cancel'"],
    ['a template literal with a substitution', 'const a = `Close ${x}`'],
    ['a JSX attribute string', '<a title="Back to map" />'],
  ])('reports %s', (_name, source) => {
    expect(findForbidden(source).length).toBeGreaterThan(0)
  })

  it.each([
    ['an identifier', 'const a = onCancel; closeMenu()'],
    ['a line comment', '// Cancel\nconst a = 1'],
    ['a block comment', '/* Please try again */ const a = 1'],
    ['an import specifier', "import x from './ConfirmDialog'"],
    ['an export-from specifier', "export { y } from './AccountMenu.view'"],
    ['a dynamic import', "const m = import('./ConfirmDialog')"],
  ])('ignores %s', (_name, source) => {
    expect(findForbidden(source)).toEqual([])
  })
})

describe('interface copy', () => {
  it('has no English strings from the copy table left in the source', () => {
    const hits: string[] = []
    for (const file of walk(SRC)) {
      for (const hit of findForbidden(readFileSync(file, 'utf8'))) hits.push(`${relative(SRC, file)}: ${hit}`)
    }
    expect([...new Set(hits)]).toEqual([])
  })
})
