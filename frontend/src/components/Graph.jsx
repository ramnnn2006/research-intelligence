import React, { useEffect, useRef } from 'react'
import * as d3 from 'd3'

const COLORS = {
  topic: '#58a6ff', paper: '#8b949e', repo: '#bc8cff',
  author: '#e3b341', root: '#3fb950', cited_by: '#f85149', reference: '#58a6ff',
}
const SIZES = {
  topic: 16, paper: 9, repo: 11, author: 7, root: 16, cited_by: 8, reference: 8,
}

export default function Graph({ data, height = 420 }) {
  const containerRef = useRef()
  const svgRef = useRef()

  useEffect(() => {
    const el = containerRef.current
    if (!el || !data?.nodes?.length) return

    // Clear previous render
    d3.select(el).selectAll('*').remove()

    // Wait a tick for layout to settle, then measure real width
    const timer = setTimeout(() => {
      const W = el.getBoundingClientRect().width || 600
      const H = height

      const svg = d3.select(el)
        .append('svg')
        .attr('width', W)
        .attr('height', H)
        .style('display', 'block')
        .style('overflow', 'visible')

      svgRef.current = svg

      // Zoom container
      const g = svg.append('g')

      svg.call(
        d3.zoom()
          .scaleExtent([0.1, 6])
          .on('zoom', e => g.attr('transform', e.transform))
      )

      const nodes = data.nodes.map(n => ({ ...n }))
      const nodeSet = new Set(nodes.map(n => n.id))
      const links = (data.links || [])
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
        .force('collision', d3.forceCollide(d => (SIZES[d.type] || 9) + 8))

      // Links
      const linkEl = g.append('g')
        .selectAll('line')
        .data(links)
        .enter().append('line')
        .attr('stroke', '#30363d')
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.8)

      // Nodes
      const nodeEl = g.append('g')
        .selectAll('circle')
        .data(nodes)
        .enter().append('circle')
        .attr('r', d => SIZES[d.type] || 9)
        .attr('fill', d => COLORS[d.type] || '#8b949e')
        .attr('stroke', '#07090f')
        .attr('stroke-width', 2)
        .style('cursor', 'pointer')
        .call(
          d3.drag()
            .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
            .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y })
            .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null })
        )

      // Labels — show for topic/root always, others only if small graph
      const showLabel = n => n.type === 'topic' || n.type === 'root' || nodes.length <= 12
      const labelEl = g.append('g')
        .selectAll('text')
        .data(nodes.filter(showLabel))
        .enter().append('text')
        .attr('fill', '#c9d1d9')
        .attr('font-size', 11)
        .attr('font-family', '-apple-system, system-ui, sans-serif')
        .attr('text-anchor', 'middle')
        .attr('dy', d => -(SIZES[d.type] || 9) - 6)
        .attr('pointer-events', 'none')
        .text(d => {
          const lbl = d.label || d.id || ''
          // Strip "TOPIC:" prefix if present
          const clean = lbl.replace(/^TOPIC:\s*/i, '')
          return clean.length > 28 ? clean.substring(0, 26) + '…' : clean
        })

      // Tooltip
      const tip = d3.select(el)
        .append('div')
        .style('position', 'absolute')
        .style('background', '#161b22')
        .style('border', '1px solid #30363d')
        .style('border-radius', '6px')
        .style('padding', '8px 11px')
        .style('font-size', '12px')
        .style('line-height', '1.6')
        .style('color', '#e6edf3')
        .style('max-width', '220px')
        .style('pointer-events', 'none')
        .style('opacity', '0')
        .style('z-index', '99')
        .style('transition', 'opacity .1s')

      nodeEl
        .on('mouseover', (event, d) => {
          const lbl = (d.label || d.id || '').replace(/^TOPIC:\s*/i, '')
          const color = COLORS[d.type] || '#8b949e'
          let html = `<span style="color:${color};font-weight:600">${(d.type || '').toUpperCase()}</span><br/>`
          html += `${lbl.substring(0, 80)}${lbl.length > 80 ? '…' : ''}`
          if (d.year) html += `<br/><span style="color:#8b949e">Year: ${d.year}</span>`
          if (d.citations) html += `<br/><span style="color:#8b949e">Citations: ${d.citations.toLocaleString()}</span>`
          if (d.stars) html += `<br/><span style="color:#e3b341">⭐ ${d.stars.toLocaleString()}</span>`
          tip.html(html)
            .style('opacity', '1')
            .style('left', (event.offsetX + 14) + 'px')
            .style('top', (event.offsetY - 8) + 'px')
        })
        .on('mousemove', event => {
          tip.style('left', (event.offsetX + 14) + 'px').style('top', (event.offsetY - 8) + 'px')
        })
        .on('mouseleave', () => tip.style('opacity', '0'))
        .on('click', (_, d) => { if (d.url) window.open(d.url, '_blank') })

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
    }, 50) // 50ms tick to let DOM settle

    return () => clearTimeout(timer)
  }, [data, height])

  const hasNodes = data?.nodes?.length > 0

  return (
    <div style={{ width: '100%' }}>
      <div
        ref={containerRef}
        style={{
          width: '100%', height, position: 'relative',
          background: '#07090f', borderRadius: 8, overflow: 'hidden',
        }}
      >
        {!hasNodes && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: '#8b949e', fontSize: 13,
          }}>
            No graph data
          </div>
        )}
      </div>
      {hasNodes && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, fontSize: 11, color: '#8b949e' }}>
          {[['#58a6ff', 'Topic'], ['#8b949e', 'Paper'], ['#bc8cff', 'Repo'], ['#e3b341', 'Author'], ['#3fb950', 'Root']].map(([c, l]) => (
            <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, display: 'inline-block' }} />
              {l}
            </span>
          ))}
          <span style={{ marginLeft: 'auto', color: '#6e7681' }}>Scroll to zoom · Drag to pan</span>
        </div>
      )}
    </div>
  )
}
