import React, { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { safeHttpUrl } from '../utils/safe'

const COLORS = {
  topic: 'var(--accent)', paper: 'var(--muted)', repo: 'var(--purple)',
  author: 'var(--orange)', root: 'var(--green)', cited_by: 'var(--red)', reference: 'var(--accent)',
  model: 'var(--copper)', dataset: 'var(--cyan)',
}
const SIZES = {
  topic: 16, paper: 9, repo: 11, author: 7, root: 16, cited_by: 8, reference: 8,
  model: 11, dataset: 10,
}

// Edge colour by relationship (search graph uses lower case, the Neo4j export upper case)
function linkColor(relation) {
  const r = String(relation || '').toLowerCase()
  if (r === 'authored') return 'var(--orange)'
  if (r === 'model') return 'var(--copper)'
  if (r === 'dataset') return 'var(--cyan)'
  if (r === 'implementation' || r === 'implements') return 'var(--purple)'
  return 'var(--accent)'
}

const radius = d => Number(d.size) || SIZES[d.type] || 9

// depth / onDepthChange are optional, pass them to show the hop slider
export default function Graph({ data, height = 420, depth, onDepthChange }) {
  // d3 owns everything inside containerRef, React never renders children into it
  const containerRef = useRef()
  const [width, setWidth] = useState(0)

  // Track the real container width. A graph rendered inside a hidden tab measures 0,
  // so we wait until it becomes visible and redraw when the width changes.
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') {
      if (el) setWidth(el.getBoundingClientRect().width || 600)
      return
    }
    const ro = new ResizeObserver(entries => {
      const w = Math.round(entries[0].contentRect.width)
      if (w > 0) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    // Clear previous render before deciding whether there is anything to draw
    d3.select(el).selectAll('*').remove()
    if (!data?.nodes?.length || !width) return

    const W = width
    const H = height

    const svg = d3.select(el)
      .append('svg')
      .attr('width', W)
      .attr('height', H)
      .style('display', 'block')
      .style('overflow', 'visible')

    // Zoom container
    const g = svg.append('g')

    svg.call(
      d3.zoom()
        .scaleExtent([0.1, 6])
        .on('zoom', e => g.attr('transform', e.transform))
    )

    const nodes = data.nodes.map(n => ({ ...n }))
    const nodeSet = new Set(nodes.map(n => n.id))
    const links = (data.links || data.edges || [])
      .map(l => ({ ...l }))
      .filter(l => {
        const s = typeof l.source === 'object' ? l.source.id : l.source
        const t = typeof l.target === 'object' ? l.target.id : l.target
        return nodeSet.has(s) && nodeSet.has(t)
      })

    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(120).strength(0.8))
      .force('charge', d3.forceManyBody().strength(-350))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('x', d3.forceX(W / 2).strength(0.05))
      .force('y', d3.forceY(H / 2).strength(0.05))
      .force('collision', d3.forceCollide(d => radius(d) + 8))

    // Links
    const linkEl = g.append('g')
      .selectAll('line')
      .data(links)
      .enter().append('line')
      .attr('stroke', d => linkColor(d.relation))
      .attr('stroke-width', 1.6)
      .attr('stroke-opacity', 0.65)

    // Nodes
    const nodeEl = g.append('g')
      .selectAll('circle')
      .data(nodes)
      .enter().append('circle')
      .attr('r', radius)
      // type decides the fill, seed / top influential nodes get a ring instead
      .attr('fill', d => COLORS[d.type] || 'var(--muted)')
      .attr('stroke', d => d.seed ? 'var(--green)' : d.is_top_influential ? 'var(--text)' : 'var(--bg)')
      .attr('stroke-width', d => d.seed ? 3 : d.is_top_influential ? 2.5 : 2)
      .style('cursor', 'pointer')
      .call(
        d3.drag()
          .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
          .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y })
          .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null })
      )

    // Labels: show for topic/root always, others only if small graph
    const showLabel = n => n.type === 'topic' || n.type === 'root' || nodes.length <= 12
    const labelEl = g.append('g')
      .selectAll('text')
      .data(nodes.filter(showLabel))
      .enter().append('text')
      .attr('fill', 'var(--text-secondary)')
      .attr('font-size', 11)
      .attr('font-family', 'var(--sans-ui)')
      .attr('text-anchor', 'middle')
      .attr('dy', d => -radius(d) - 6)
      .attr('pointer-events', 'none')
      .text(d => {
        const lbl = String(d.label || d.id || '')
        // Strip "TOPIC:" prefix if present
        const clean = lbl.replace(/^TOPIC:\s*/i, '')
        return clean.length > 28 ? clean.substring(0, 26) + '…' : clean
      })

    // Tooltip
    const tip = d3.select(el)
      .append('div')
      .style('position', 'absolute')
      .style('background', 'var(--panel2)')
      .style('border', '1px solid var(--border2)')
      .style('border-radius', '6px')
      .style('padding', '8px 11px')
      .style('font-size', '12px')
      .style('line-height', '1.6')
      .style('color', 'var(--text)')
      .style('max-width', '220px')
      .style('pointer-events', 'none')
      .style('opacity', '0')
      .style('z-index', '99')
      .style('transition', 'opacity .1s')

    nodeEl
      .on('mouseover', (event, d) => {
        const lbl = String(d.label || d.id || '').replace(/^TOPIC:\s*/i, '')
        const rows = [
          [COLORS[d.type] || 'var(--muted)', String(d.type || '').toUpperCase(), 600],
          [null, `${lbl.substring(0, 80)}${lbl.length > 80 ? '…' : ''}`],
          d.year && ['var(--muted)', `Year: ${d.year}`],
          d.citations && ['var(--muted)', `Citations: ${d.citations.toLocaleString()}`],
          d.stars && ['var(--orange)', `★ ${d.stars.toLocaleString()}`],
          d.pagerank != null && ['var(--accent)', `PageRank: ${d.pagerank}`],
          d.betweenness != null && ['var(--purple)', `Betweenness: ${d.betweenness}`],
          d.community != null && ['var(--orange)', `Cluster: ${d.community}`],
          d.is_top_influential && ['var(--text)', 'Top influential'],
          d.seed && ['var(--green)', 'Seed paper'],
        ].filter(Boolean)
        tip.selectAll('*').remove()
        rows.forEach(([color, text, weight], i) => {
          if (i) tip.append('br')
          tip.append('span').style('color', color).style('font-weight', weight).text(text)
        })
        tip
          .style('opacity', '1')
          .style('left', (event.offsetX + 14) + 'px')
          .style('top', (event.offsetY - 8) + 'px')
      })
      .on('mousemove', event => {
        tip.style('left', (event.offsetX + 14) + 'px').style('top', (event.offsetY - 8) + 'px')
      })
      .on('mouseleave', () => tip.style('opacity', '0'))
      .on('click', (_, d) => {
        const url = safeHttpUrl(d.url)
        if (url) window.open(url, '_blank', 'noopener,noreferrer')
      })

    sim.on('tick', () => {
      // Clamp nodes inside bounds with padding
      const pad = 20
      nodes.forEach(d => {
        d.x = Math.max(pad, Math.min(W - pad, d.x))
        d.y = Math.max(pad, Math.min(H - pad, d.y))
      })
      linkEl
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y)
      nodeEl.attr('cx', d => d.x).attr('cy', d => d.y)
      labelEl.attr('x', d => d.x).attr('y', d => d.y)
    })

    return () => { sim.stop() }
  }, [data, height, width])

  const hasNodes = data?.nodes?.length > 0

  return (
    <div className="ri-graph" style={{ width: '100%' }}>
      {onDepthChange && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, fontSize: 12, color: 'var(--muted)' }}>
          <span>Traversal depth</span>
          <input
            type="range" aria-label="Traversal depth in hops" aria-valuetext={`${depth || 1}-hop`} min={1} max={3} step={1} value={depth || 1}
            onChange={e => onDepthChange(Number(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--accent)', cursor: 'pointer' }}
          />
          <span style={{ color: 'var(--accent)', fontWeight: 600, minWidth: 42, textAlign: 'right' }}>{depth || 1}-hop</span>
        </div>
      )}
      <div
        style={{
          width: '100%', height, position: 'relative',
          background: 'var(--bg)', borderRadius: 8, overflow: 'hidden',
        }}
      >
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
        {!hasNodes && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: 'var(--muted)', fontSize: 13,
          }}>
            No graph data
          </div>
        )}
      </div>
      {hasNodes && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
          {[['var(--accent)', 'Topic'], ['var(--muted)', 'Paper'], ['var(--copper)', 'Model'], ['var(--cyan)', 'Dataset'], ['var(--purple)', 'Repo'], ['var(--orange)', 'Author'], ['var(--green)', 'Root']].map(([c, l]) => (
            <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, display: 'inline-block' }} />
              {l}
            </span>
          ))}
          <span style={{ marginLeft: 'auto', color: 'var(--muted2)' }}>Scroll to zoom · Drag to pan</span>
        </div>
      )}
    </div>
  )
}
