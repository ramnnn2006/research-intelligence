import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint({ cwd: new URL('..', import.meta.url).pathname })
const lint = async code => (await eslint.lintText(code, { filePath: 'src/fixture.jsx' }))[0].messages.filter(m => m.severity === 2)

const UNSAFE = {
  'jsx dangerouslySetInnerHTML': 'export const A = ({s}) => <div dangerouslySetInnerHTML={{ __html: s }} />',
  'createElement prop': 'const e = React.createElement("div", { dangerouslySetInnerHTML: { __html: s } })',
  'd3 .html()': 'd3.select(el).html(s)',
  'innerHTML =': 'el.innerHTML = s',
  'innerHTML +=': 'el.innerHTML += s',
  'bracket literal': 'el["innerHTML"] = s',
  'outerHTML': 'el.outerHTML = s',
  'insertAdjacentHTML': 'el.insertAdjacentHTML("beforeend", s)',
  'document.write': 'document.write(s)',
  'DOMParser': 'new DOMParser().parseFromString(s, "text/html")',
  'createContextualFragment': 'document.createRange().createContextualFragment(s)',
  'Object.assign innerHTML': 'Object.assign(el, { innerHTML: s })',
  'Object.assign string key': 'Object.assign(el, { "outerHTML": s })',
  'srcdoc assignment': 'frame.srcdoc = s',
  'setAttribute srcdoc': 'frame.setAttribute("srcdoc", s)',
  'setAttribute onerror': 'img.setAttribute("onerror", s)',
  'JSX srcDoc': 'export const A = ({s}) => <iframe srcDoc={s} />',
  'eval': 'eval(s)',
  'new Function': 'new Function(s)()',
  'script-scheme url': `a.href = "${['java', 'script:'].join('')}" + s`,
}
const SAFE = {
  'jsx text': 'export const A = ({s}) => <div>{s}</div>',
  'd3 text': 'd3.select(el).text(s).append("span").text(s)',
  'textContent': 'el.textContent = s',
  'setAttribute href': 'a.setAttribute("href", s)',
  'Object.assign style': 'Object.assign(el.style, { color: "red" })',
}

describe('lint rules catch HTML-string and code-execution sinks', () => {
  it.each(Object.entries(UNSAFE))('flags %s', async (_, code) => {
    expect((await lint(code)).length).toBeGreaterThan(0)
  })
  it.each(Object.entries(SAFE))('allows %s', async (_, code) => {
    expect(await lint(code)).toEqual([])
  })
})
