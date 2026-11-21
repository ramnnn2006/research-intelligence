import React, { useState, useEffect, useRef } from 'react'

const CHANNELS = [
  { src: '/assets/landing/tv-ch1.jpg', alt: 'A tabby cat sits among library books, cut out like a sticker over a blue-printed bookshelf photo' },
  { src: '/assets/landing/tv-ch2.jpg', alt: 'Library card catalog drawers printed in blue ink on cream paper' },
  { src: '/assets/landing/tv-ch3.jpg', alt: 'A wall of vintage card catalog drawers printed in blue ink on cream paper' },
]

function Tv() {
  const [channel, setChannel] = useState(0)
  const [staticOn, setStaticOn] = useState(false)
  const [dip, setDip] = useState(false)
  const timers = useRef([])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const zap = () => {
    const next = (channel + 1) % CHANNELS.length
    timers.current.forEach(clearTimeout)
    timers.current = []
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setChannel(next); setStaticOn(false); setDip(false); return
    }
    // anticipation dip, static burst, settle on the next channel
    setDip(true); setStaticOn(true)
    timers.current.push(setTimeout(() => setChannel(next), 170))
    timers.current.push(setTimeout(() => { setStaticOn(false); setDip(false) }, 300))
  }

  return (
    <div
      className="tv" role="button" tabIndex={0} aria-label="Change the channel"
      onClick={zap}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zap() } }}
    >
      <div className="tv-body">
        <div className={`tv-screen${dip ? ' dip' : ''}`}>
          {CHANNELS.map((c, i) => (
            <img key={c.src} className={i === channel ? 'on' : ''} src={c.src} alt={i === channel ? c.alt : ''} aria-hidden={i === channel ? undefined : true} />
          ))}
          <img className={`tv-static${staticOn ? ' on' : ''}`} src="/assets/landing/tv-static.jpg" alt="" aria-hidden="true" />
        </div>
        <div className="tv-knobs"><span></span><span></span></div>
      </div>
      <div className="tv-legs"><span></span><span></span></div>
    </div>
  )
}

export default function Landing({ onEnter }) {
  const root = useRef(null)

  useEffect(() => {
    const el = root.current
    if (!el) return
    let fired = false
    const revealAll = () => el.querySelectorAll('.reveal').forEach(n => n.classList.add('in'))
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(entries => {
        fired = true
        entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } })
      }, { threshold: 0.15, root: el })
      el.querySelectorAll('.reveal').forEach(n => io.observe(n))
      const t = setTimeout(() => { if (!fired) revealAll() }, 1200)
      return () => { clearTimeout(t); io.disconnect() }
    }
    revealAll()
  }, [])

  return (
    <div className="landing js" ref={root}>
      <nav>
        <a className="mark" href="#">R!</a>
        <div className="nav-links">
          <a href="#how">[ How ]</a>
          <a href="#sources">[ Sources ]</a>
          <a href="#stack">[ Stack ]</a>
          <button className="pill" onClick={onEnter}>Open the app</button>
        </div>
      </nav>

      <header className="hero">
        <h1>Research<br />
          <span className="l2">intelligence</span>
          <span className="doodle">
            <svg viewBox="0 0 80 60" width="74" fill="none" stroke="var(--accent)" strokeWidth="2">
              <circle cx="14" cy="46" r="5" fill="var(--cream)" />
              <circle cx="40" cy="16" r="5" fill="var(--yellow)" />
              <circle cx="66" cy="40" r="5" fill="var(--cream)" />
              <circle cx="52" cy="54" r="4" fill="var(--cream)" />
              <path d="M18 42 L36 20 M44 20 L62 36 M19 46 L48 53 M55 51 L63 44" />
            </svg>
            <span className="doodle-cap">now indexing</span>
          </span>
        </h1>
        <p className="hero-sub">Open source. Five academic sources, one living citation graph.</p>
      </header>

      <div className="trio">
        <span className="word">Papers</span><span className="slash">/</span>
        <Tv />
        <span className="word">Graph</span><span className="slash">/</span><span className="word">Answers</span>
        <div className="trio-line">Papers&nbsp;&nbsp;/&nbsp;&nbsp;Graph&nbsp;&nbsp;/&nbsp;&nbsp;Answers</div>
      </div>

      <div className="band">
        <div className="stamps">
          <div className="stamp reveal" style={{ '--i': 0 }}>
            <img src="/assets/landing/stamp-graph.jpg" alt="Citation graph view" />
            <h3>Citation Graph</h3>
            <p>papers · authors · topics, linked</p>
            <span className="tag">Neo4j</span>
          </div>
          <div className="stamp reveal" style={{ '--i': 1 }}>
            <img src="/assets/landing/stamp-survey.jpg" alt="Survey generator" />
            <h3>Survey Generator</h3>
            <p>state of the art, structured</p>
            <span className="tag">70B</span>
          </div>
          <div className="stamp reveal" style={{ '--i': 2 }}>
            <img src="/assets/landing/stamp-paper-compare.jpg" alt="Paper comparison" />
            <h3>Compare Papers</h3>
            <p>method · data · results, side by side</p>
            <span className="tag">VS</span>
          </div>
          <div className="stamp reveal" style={{ '--i': 3 }}>
            <img src="/assets/landing/stamp-chat.jpg" alt="Chat with papers" />
            <h3>Chat with Papers</h3>
            <p>answers with citations</p>
            <span className="tag">RAG</span>
          </div>
          <div className="stamp reveal" style={{ '--i': 4 }}>
            <img src="/assets/landing/stamp-literature-review-generator.jpg" alt="Literature review generator" />
            <h3>Review Generator</h3>
            <p>gaps to future directions</p>
            <span className="tag">LLM</span>
          </div>
        </div>
      </div>

      <div className="mid reveal">
        <p className="note">From a pile of tabs and PDFs to one graph you can search, compare and chat with.</p>
        <button className="cta" onClick={onEnter}>Open the app <span>&rarr;</span></button>
      </div>

      <section className="page" id="how">
        <p className="kicker">[ How it works ]</p>
        <div className="steps">
          <div className="step reveal" style={{ '--i': 0 }}>
            <div className="num">01</div>
            <h4>Ingest</h4>
            <p>Pulls papers in parallel from arXiv, Semantic Scholar, CrossRef, PubMed and GitHub via MCP.</p>
          </div>
          <div className="step reveal" style={{ '--i': 1 }}>
            <div className="num">02</div>
            <h4>Deduplicate</h4>
            <p>Merges duplicates across sources into canonical papers with enriched metadata.</p>
          </div>
          <div className="step reveal" style={{ '--i': 2 }}>
            <div className="num">03</div>
            <h4>Graph</h4>
            <p>Stores papers, authors, topics, repos and citations as a living Neo4j knowledge graph.</p>
          </div>
          <div className="step reveal" style={{ '--i': 3 }}>
            <div className="num">04</div>
            <h4>Answer</h4>
            <p>Generates reviews, surveys, gap reports and comparisons, all grounded in the graph with citations.</p>
          </div>
        </div>
      </section>

      <section className="page" id="sources">
        <p className="kicker">[ Five sources, one search ]</p>
        <div className="sources">
          <div className="source-row reveal" style={{ '--i': 0 }}><span className="name">arXiv</span><span className="role">preprints</span></div>
          <div className="source-row reveal" style={{ '--i': 1 }}><span className="name">Semantic Scholar</span><span className="role">citations &amp; metadata</span></div>
          <div className="source-row reveal" style={{ '--i': 2 }}><span className="name">CrossRef</span><span className="role">DOI &amp; references</span></div>
          <div className="source-row reveal" style={{ '--i': 3 }}><span className="name">PubMed</span><span className="role">biomedical papers</span></div>
          <div className="source-row reveal" style={{ '--i': 4 }}><span className="name">GitHub</span><span className="role">implementations</span></div>
        </div>
      </section>

      <section className="page" id="stack">
        <p className="kicker">[ Graph algorithms, built in ]</p>
        <div className="alg">
          <div>PageRank<span>influential papers</span></div>
          <div>Betweenness<span>bridging papers</span></div>
          <div>HITS<span>hubs &amp; authorities</span></div>
          <div>Communities<span>topic clusters</span></div>
        </div>
        <p className="kicker" style={{ marginTop: 64 }}>[ Under the hood ]</p>
        <div className="chips">
          <span className="chip">FastAPI</span><span className="chip">React</span><span className="chip">Neo4j</span>
          <span className="chip">MongoDB</span><span className="chip">LangChain</span><span className="chip">Groq</span>
          <span className="chip">MCP</span><span className="chip">D3.js</span><span className="chip">NetworkX</span>
        </div>
      </section>

      <div className="finale reveal">
        <h2>read <span className="hl">together?</span></h2>
      </div>

      <footer>
        <div>
          <div className="sig">ResearchIQ</div>
          <div className="copy">&copy; 2026</div>
        </div>
        <div className="f-links">
          <a href="https://github.com/ramnnn2006/research-intelligence">GITHUB &#8599;</a>
          <a href="https://linkedin.com/in/ramnnn">LINKEDIN &#8599;</a>
          <a href="mailto:ramakrishnan.ph18@gmail.com">EMAIL &#8599;</a>
          <a href="https://arxiv.org">ARXIV &#8599;</a>
        </div>
      </footer>
    </div>
  )
}
