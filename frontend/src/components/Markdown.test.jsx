import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Markdown from './Markdown'

const html = text => renderToStaticMarkup(<Markdown text={text} />)

describe('Markdown keeps every supported construct', () => {
  it('headings, bullet and numbered lists', () => {
    const out = html('## Title\n### Sub\n- one\n- two\n\n1. first\n2. second')
    expect(out).toContain('<h3')
    expect(out).toContain('<h4')
    expect(out.match(/<ul/g)).toHaveLength(2)
    expect(out.match(/<li/g)).toHaveLength(4)
  })

  it('bold, italic and inline code', () => {
    const out = html('**bold** and *em* and `a*b` here')
    expect(out).toContain('<strong>bold</strong>')
    expect(out).toContain('<em>em</em>')
    expect(out).toMatch(/<code[^>]*>a\*b<\/code>/)
  })

  it('page citations become badges, including ranges', () => {
    const out = html('See [Page 5] and [Page 3, 4].')
    expect(out).toContain('>Page 5</span>')
    expect(out).toContain('>Page 3, 4</span>')
  })

  it('tables keep math pipes, code pipes, escaped pipes and <br>', () => {
    const out = html('| Method | Cost |\n|---|---|\n| scan | \\(O(|V|)\\) |\n| `a|b` | x\\|y |\n| multi | one<br>two |')
    expect(out).toContain('<table')
    expect(out.match(/<th[ >]/g)).toHaveLength(2)
    expect(out.match(/<tr/g)).toHaveLength(4)
    expect(out).toContain('\\(O(|V|)\\)')
    expect(out).toContain('x|y')
    expect(out).toContain('one<br/>two')
  })

  it('bare set sizes only split on spaced pipes', () => {
    const out = html('| Name | Cost |\n|---|---|\n| scan | O(|V| + |E|) |')
    expect(out.match(/<td/g)).toHaveLength(2)
    expect(out).toContain('O(|V| + |E|)')
  })

  it('empty input renders nothing', () => {
    expect(html('')).toBe('')
    expect(html(null)).toBe('')
  })
})

describe('Markdown never turns text into markup', () => {
  const payloads = [
    '<img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    '**<b onmouseover=alert(1)>x</b>**',
    '| a |\n|---|\n| <img src=x onerror=alert(1)> |',
    '## <svg onload=alert(1)>',
    '- <iframe src="javascript:alert(1)"></iframe>',
    '`<img src=x onerror=alert(1)>`',
  ]
  it.each(payloads)('escapes %s', payload => {
    const out = html(payload)
    expect(out).not.toMatch(/<(img|script|svg|iframe|b)[\s>]/i)
    expect(out).toContain('&lt;')
  })
})
