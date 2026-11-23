import React from 'react'
import { toText } from '../utils/safe'

const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_SEP = /^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*(:?-{3,}:?\s*)?$/
const INLINE = /(`[^`\n]+`)|(\*\*.+?\*\*)|(\*.+?\*)|(\[Page\s*[0-9,\s-]+\])/gi

const CELL = { border: '1px solid var(--border)', padding: '6px 8px', textAlign: 'left', verticalAlign: 'top' }
const CODE = { background: 'rgba(var(--accent-rgb),0.09)', padding: '1px 5px', borderRadius: 4, fontFamily: 'monospace', fontSize: 12 }
const BADGE = {
  display: 'inline-flex', alignItems: 'center', background: 'rgba(var(--accent-rgb),0.15)', color: 'var(--accent)',
  border: '1px solid rgba(var(--accent-rgb),0.35)', padding: '1px 6px', borderRadius: 12, fontSize: 11,
  fontWeight: 600, margin: '0 2px', letterSpacing: '0.02em',
}
const HEADINGS = {
  3: { tag: 'h4', style: { color: 'var(--accent)', margin: '12px 0 4px', fontSize: 13, fontWeight: 600 } },
  2: { tag: 'h3', style: { color: 'var(--accent)', margin: '14px 0 6px', fontSize: 14, fontWeight: 600 } },
}

// Splits on "|" except inside \( \) math (e.g. |E|), inline code, or an escaped \|
function splitCells(row) {
  const cells = []
  let cur = '', math = false, code = false
  for (let i = 0; i < row.length; i++) {
    const ch = row[i], next = row[i + 1]
    if (ch === '\\' && next === '|') { cur += '|'; i++; continue }
    if (ch === '\\' && (next === '(' || next === ')')) { math = next === '('; cur += ch + next; i++; continue }
    if (ch === '`') code = !code
    if (ch === '|' && !math && !code) { cells.push(cur); cur = ''; continue }
    cur += ch
  }
  cells.push(cur)
  return cells
}

// Bare set sizes such as O(|V| + |E|) only count as a column pipe when spaced on both sides
function tableCells(line, expected) {
  const row = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  let cells = splitCells(row)
  if (expected && cells.length !== expected) {
    const spaced = row.split(/(?<=\s)\|(?=\s)/)
    if (spaced.length === expected) cells = spaced
  }
  return cells.map(c => c.trim())
}

function inline(text, keyBase) {
  const out = []
  let last = 0, n = 0
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const key = `${keyBase}-${n++}`
    if (m[1]) out.push(<code key={key} style={CODE}>{m[1].slice(1, -1)}</code>)
    else if (m[2]) out.push(<strong key={key}>{inline(m[2].slice(2, -2), key)}</strong>)
    else if (m[3]) out.push(<em key={key}>{inline(m[3].slice(1, -1), key)}</em>)
    else out.push(<span key={key} style={BADGE}>Page {m[4].replace(/^\[Page\s*/i, '').slice(0, -1)}</span>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function lineBreaks(text, key) {
  const parts = text.split(/<br\s*\/?>/i)
  return parts.flatMap((p, i) => (i ? [<br key={`${key}-br${i}`} />, ...inline(p, `${key}-${i}`)] : inline(p, `${key}-${i}`)))
}

function parse(text) {
  const lines = text.split('\n')
  const blocks = []
  let para = [], list = null
  const flushPara = () => { if (para.length) blocks.push({ type: 'p', lines: para }); para = [] }
  const flushList = () => { if (list) blocks.push({ type: 'ul', items: list }); list = null }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      flushPara(); flushList()
      const head = tableCells(line)
      const rows = []
      let j = i + 2
      while (j < lines.length && TABLE_ROW.test(lines[j])) rows.push(tableCells(lines[j++], head.length))
      blocks.push({ type: 'table', head, rows })
      i = j - 1
      continue
    }
    const heading = /^(##|###) (.+)$/.exec(line)
    const item = /^(?:- |\d+\. )(.+)$/.exec(line)
    if (heading) { flushPara(); flushList(); blocks.push({ type: 'h', level: heading[1].length, text: heading[2] }) }
    else if (item) { flushPara(); (list ||= []).push(item[1]) }
    else if (!line.trim()) { flushPara(); flushList() }
    else { flushList(); para.push(line) }
  }
  flushPara(); flushList()
  return blocks
}

function Block({ block, k }) {
  if (block.type === 'h') {
    const { tag: Tag, style } = HEADINGS[block.level]
    return <Tag style={style}>{lineBreaks(block.text, k)}</Tag>
  }
  if (block.type === 'ul') {
    return <ul style={{ paddingLeft: 18, margin: '8px 0' }}>{block.items.map((t, i) => <li key={i} style={{ margin: '4px 0' }}>{lineBreaks(t, `${k}-${i}`)}</li>)}</ul>
  }
  if (block.type === 'table') {
    return (
      <div style={{ overflowX: 'auto', margin: '8px 0' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead><tr>{block.head.map((c, i) => <th key={i} style={{ ...CELL, background: 'rgba(var(--accent-rgb),0.07)' }}>{lineBreaks(c, `${k}-h${i}`)}</th>)}</tr></thead>
          <tbody>{block.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} style={CELL}>{lineBreaks(c, `${k}-${ri}-${ci}`)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    )
  }
  return <p style={{ margin: '8px 0' }}>{block.lines.flatMap((l, i) => (i ? [<br key={`${k}-b${i}`} />, ...inline(l, `${k}-${i}`)] : inline(l, `${k}-${i}`)))}</p>
}

export default function Markdown({ text, style }) {
  const source = toText(text)
  if (!source) return null
  return <div style={style}>{parse(source).map((b, i) => <Block key={i} block={b} k={`b${i}`} />)}</div>
}
