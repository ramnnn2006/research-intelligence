import React from 'react'

export function Skeleton({ w = '100%', h = 12, r = 4, style }) {
  return <span className="ri-skel" style={{ display: 'block', width: w, height: h, borderRadius: r, ...style }} />
}

export function PaperSkeleton() {
  return (
    <div className="ri-skel-card" aria-hidden="true">
      <Skeleton w="78%" h={15} />
      <Skeleton w="38%" h={10} />
      <Skeleton h={10} />
      <Skeleton w="92%" h={10} />
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <Skeleton w={70} h={20} r={10} />
        <Skeleton w={90} h={20} r={10} />
      </div>
    </div>
  )
}

export function PaperSkeletons({ n = 4 }) {
  return (
    <div role="status" aria-label="Loading results" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: n }, (_, i) => <PaperSkeleton key={i} />)}
    </div>
  )
}

// Stand-in for a generated document (review, survey, roadmap, gaps).
export function DocSkeleton({ label = 'Working…' }) {
  return (
    <div className="ri-skel-card" role="status" aria-label={label} style={{ padding: 20, gap: 12 }}>
      <Skeleton w="40%" h={18} />
      {[100, 96, 99, 60].map((w, i) => <Skeleton key={i} w={`${w}%`} h={10} />)}
      <Skeleton w="30%" h={14} style={{ marginTop: 10 }} />
      {[98, 94, 70].map((w, i) => <Skeleton key={i} w={`${w}%`} h={10} />)}
      <Skeleton w="34%" h={14} style={{ marginTop: 10 }} />
      {[97, 90, 55].map((w, i) => <Skeleton key={i} w={`${w}%`} h={10} />)}
    </div>
  )
}
