import react from 'eslint-plugin-react'

const FIX = 'Never assign HTML strings. Render untrusted text as JSX children, d3 .text()/.append(), or <Markdown> from components/Markdown.jsx.'
const sink = (selector) => ({ selector, message: FIX })

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { react },
    rules: {
      'react/no-danger': 'error',
      'react/no-danger-with-children': 'error',
      'no-restricted-syntax': ['error',
        sink("JSXAttribute[name.name='dangerouslySetInnerHTML']"),
        sink("Property[key.name='dangerouslySetInnerHTML']"),
        sink("CallExpression[callee.property.name=/^(html|insertAdjacentHTML|write|writeln|parseFromString|createContextualFragment)$/]"),
        sink("AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]"),
        sink("AssignmentExpression[left.property.value=/^(innerHTML|outerHTML)$/]"),
        sink("AssignmentExpression[left.property.name='srcdoc']"),
        sink("JSXAttribute[name.name='srcDoc']"),
        sink("CallExpression[callee.property.name='assign'] Property[key.name=/^(innerHTML|outerHTML|srcdoc)$/]"),
        sink("CallExpression[callee.property.name='assign'] Property[key.value=/^(innerHTML|outerHTML|srcdoc)$/]"),
        sink("CallExpression[callee.property.name='setAttribute'][arguments.0.value=/^(srcdoc|on.*)$/i]"),
        sink("CallExpression[callee.name=/^(eval|Function)$/]"),
        sink("NewExpression[callee.name='Function']"),
        sink("Literal[value=/^javascript:/i]"),
      ],
    },
  },
]
