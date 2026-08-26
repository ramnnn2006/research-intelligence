import React from 'react'

const badge = {arxiv:{bg:'rgba(88,166,255,.12)',c:'#58a6ff'},
               semantic_scholar:{bg:'rgba(124,58,237,.15)',c:'#bc8cff'}}

export default function PaperCard({ paper, onSelect, selected }) {
  const src = paper.source === 'semantic_scholar' ? 'semantic_scholar' : 'arxiv'
  const b = badge[src]
  return (
    <div onClick={() => onSelect && onSelect(paper)}
      style={{background:'var(--panel2)',border:`1px solid ${selected?'#58a6ff':'#21262d'}`,
        borderRadius:'var(--radius)',padding:'12px',cursor:onSelect?'pointer':'default',
        transition:'border-color .15s'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:4}}>
        <a href={paper.url||paper.id} target="_blank" rel="noreferrer"
          style={{fontWeight:600,fontSize:13,color:'var(--accent)',lineHeight:1.4,flex:1}}
          onClick={e=>e.stopPropagation()}>
          {paper.title}
        </a>
        <span style={{background:b.bg,color:b.c,padding:'2px 6px',borderRadius:4,
          fontSize:11,fontWeight:600,flexShrink:0,whiteSpace:'nowrap'}}>
          {src === 'semantic_scholar' ? 'Scholar' : 'ArXiv'}
        </span>
      </div>
      <div style={{fontSize:12,color:'var(--muted)',marginBottom:6}}>
        {(paper.authors||[]).slice(0,3).join(', ')}{paper.year ? ` · ${paper.year}` : ''}
        {paper.citations ? ` · ${paper.citations} citations` : ''}
      </div>
      <div style={{fontSize:12,color:'var(--muted2)',lineHeight:1.55,
        overflow:'hidden',display:'-webkit-box',WebkitLineClamp:3,WebkitBoxOrient:'vertical'}}>
        {paper.summary}
      </div>
    </div>
  )
}
