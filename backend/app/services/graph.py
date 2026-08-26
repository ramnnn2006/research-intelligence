import networkx as nx

def build_knowledge_graph(topic: str, papers: list, repos: list = []) -> dict:
    G = nx.DiGraph()
    topic_node = f"TOPIC:{topic}"
    G.add_node(topic_node, type="topic", label=topic)

    for p in papers:
        title = p.get("title","")[:80]
        if not title: continue
        G.add_node(title, type="paper", year=p.get("year",""),
                   url=p.get("url",""), citations=p.get("citations",0),
                   source=p.get("source",""))
        G.add_edge(topic_node, title, relation="related")
        for author in p.get("authors",[])[:2]:
            if not author: continue
            G.add_node(author, type="author")
            G.add_edge(author, title, relation="authored")

    for r in repos:
        name = r.get("name","")
        if not name: continue
        G.add_node(name, type="repo", url=r.get("url",""), stars=r.get("stars",0))
        G.add_edge(topic_node, name, relation="implementation")

    try:
        scores = nx.degree_centrality(G)
        for n in G.nodes: G.nodes[n]["centrality"] = round(scores.get(n,0.05),3)
    except: pass

    return nx.node_link_data(G)

def build_citation_graph(paper_title: str, citation_data: dict) -> dict:
    G = nx.DiGraph()
    G.add_node(paper_title, type="root")
    for c in (citation_data.get("citations") or [])[:15]:
        t = c.get("title","")
        if t:
            G.add_node(t, type="cited_by")
            G.add_edge(paper_title, t, relation="cited_by")
    for r in (citation_data.get("references") or [])[:15]:
        t = r.get("title","")
        if t:
            G.add_node(t, type="reference")
            G.add_edge(t, paper_title, relation="references")
    return nx.node_link_data(G)
