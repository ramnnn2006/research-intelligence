import React, { useState, useEffect, useRef } from 'react'
import { safeHttpUrl, toText, asArray } from '../utils/safe'
import Ic from './Ic'

// transformers Auto class per Hugging Face pipeline tag
const AUTO_CLASS = {
  'text-generation': 'AutoModelForCausalLM',
  'text2text-generation': 'AutoModelForSeq2SeqLM',
  'summarization': 'AutoModelForSeq2SeqLM',
  'translation': 'AutoModelForSeq2SeqLM',
  'text-classification': 'AutoModelForSequenceClassification',
  'token-classification': 'AutoModelForTokenClassification',
  'question-answering': 'AutoModelForQuestionAnswering',
  'fill-mask': 'AutoModelForMaskedLM',
  'feature-extraction': 'AutoModel',
}

function pythonSnippet(model) {
  const id = JSON.stringify(String(model.id || ''))
  const tag = String(model.pipeline_tag || '')
  if (tag === 'text-to-image' || tag === 'image-to-image') {
    return `from diffusers import DiffusionPipeline\n\npipe = DiffusionPipeline.from_pretrained(${id})`
  }
  if (tag === 'sentence-similarity') {
    return `from sentence_transformers import SentenceTransformer\n\nmodel = SentenceTransformer(${id})`
  }
  const cls = AUTO_CLASS[tag]
  if (cls) {
    return `from transformers import ${cls}, AutoTokenizer\n\nmodel_id = ${id}\ntokenizer = AutoTokenizer.from_pretrained(model_id)\nmodel = ${cls}.from_pretrained(model_id)`
  }
  if (tag && tag !== 'general') {
    return `from transformers import pipeline\n\npipe = pipeline(${JSON.stringify(tag)}, model=${id})`
  }
  // unknown task: let transformers read the task from the model card
  return `from transformers import pipeline\n\npipe = pipeline(model=${id})`
}

async function copyText(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }
  // navigator.clipboard is missing on plain http origins, fall back to execCommand
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try {
    if (!document.execCommand('copy')) throw new Error('copy command was rejected')
  } finally {
    document.body.removeChild(ta)
  }
}

function Tags({ tags }) {
  const list = asArray(tags).map(toText).filter(Boolean)
  if (!list.length) return null
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
      {list.map((t, idx) => (
        <span key={idx} style={{
          background: 'var(--panel)', border: '1px solid var(--border2)',
          color: 'var(--muted2)', padding: '1px 6px', borderRadius: 4, fontSize: 10
        }}>
          {t}
        </span>
      ))}
    </div>
  )
}

export function ModelCard({ model }) {
  const [copyState, setCopyState] = useState('idle') // 'idle' | 'copied' | 'failed'
  const timer = useRef()
  useEffect(() => () => clearTimeout(timer.current), [])

  const copySnippet = async () => {
    try {
      await copyText(pythonSnippet(model))
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopyState('idle'), 2000)
  }

  const url = safeHttpUrl(model.url)
  const copied = copyState === 'copied'
  const failed = copyState === 'failed'

  return (
    <div className="ri-hf-card" style={{
      background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8,
      padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8,
      transition: 'border-color .15s'
    }}
    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--copper)'}
    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}><Ic d="box" /> {toText(model.author)}/</span>
            {url ? (
              <a href={url} target="_blank" rel="noreferrer"
                style={{ fontSize: 14, fontWeight: 600, color: 'var(--copper)', textDecoration: 'none' }}>
                {toText(model.name)}
              </a>
            ) : (
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--copper)' }}>{toText(model.name)}</span>
            )}
            {model.pipeline_tag && (
              <span style={{
                background: 'rgba(var(--accent-rgb),0.12)', color: 'var(--accent)',
                padding: '2px 7px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                border: '1px solid rgba(var(--accent-rgb),0.25)'
              }}>
                {toText(model.pipeline_tag)}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button
            onClick={copySnippet}
            style={{
              background: copied ? 'rgba(var(--green-rgb),0.2)' : failed ? 'rgba(193,59,46,0.12)' : 'rgba(var(--accent-rgb),0.08)',
              color: copied ? 'var(--green)' : failed ? 'var(--red)' : 'var(--muted)',
              border: `1px solid ${copied ? 'rgba(var(--green-rgb),0.4)' : failed ? 'rgba(193,59,46,0.4)' : 'var(--border2)'}`,
              borderRadius: 5, padding: '3px 8px', fontSize: 11, cursor: 'pointer'
            }}
          >
            {copied ? '✓ Snippet copied' : failed ? '✕ Copy failed' : <><Ic d="clip" /> Python snippet</>}
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11, color: 'var(--muted)' }}>
        <span><Ic d="down" /> {(Number(model.downloads) || 0).toLocaleString()} downloads</span>
        <span><Ic d="heart" /> {(Number(model.likes) || 0).toLocaleString()} likes</span>
        {model.arxiv_id && (
          <a
            href={`https://arxiv.org/abs/${encodeURI(toText(model.arxiv_id))}`}
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--accent)', fontSize: 11 }}
          >
            <Ic d="doc" /> Paper ({toText(model.arxiv_id)})
          </a>
        )}
      </div>

      <Tags tags={model.tags} />
    </div>
  )
}

export function DatasetCard({ dataset }) {
  const url = safeHttpUrl(dataset.url)
  return (
    <div className="ri-hf-card" style={{
      background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8,
      padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8,
      transition: 'border-color .15s'
    }}
    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--cyan)'}
    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}><Ic d="chart" /> {toText(dataset.author)}/</span>
          {url ? (
            <a href={url} target="_blank" rel="noreferrer"
              style={{ fontSize: 14, fontWeight: 600, color: 'var(--cyan)', textDecoration: 'none' }}>
              {toText(dataset.name)}
            </a>
          ) : (
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--cyan)' }}>{toText(dataset.name)}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--muted)' }}>
          <span><Ic d="down" /> {(Number(dataset.downloads) || 0).toLocaleString()} downloads</span>
          <span><Ic d="heart" /> {(Number(dataset.likes) || 0).toLocaleString()} likes</span>
        </div>
      </div>

      <Tags tags={dataset.tags} />
    </div>
  )
}
