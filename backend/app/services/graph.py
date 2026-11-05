import networkx as nx
from typing import Dict, Any, List
from app.db.neo4j_client import get_neo4j_client


def _node_link(G) -> dict:
    """
    nx.node_link_data with the edge list under both "links" and "edges".
    networkx < 3.4 only knows "links", 3.4 and 3.5 warn about the default,
    and 3.6+ default to "edges"; the frontend reads "links".
    """
    try:
        data = nx.node_link_data(G, edges="links")
    except TypeError:  # networkx < 3.4 has no edges= argument
        data = nx.node_link_data(G)
    edges = data.get("links")
    if edges is None:
        edges = data.get("edges", [])
    data["links"] = edges
    data["edges"] = edges
    return data


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
    except Exception:
        pass

    return _node_link(G)

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
    return _node_link(G)

def fetch_neo4j_subgraph(topic: str = "", limit: int = 40) -> dict:
    """
    Directly query Neo4j graph nodes and relationships to generate a visual graph representation.
    """
    client = get_neo4j_client()
    G = nx.DiGraph()
    
    if client.connect():
        if topic:
            cypher = """
            MATCH (t:Topic)
            WHERE toLower(t.name) CONTAINS toLower($topic)
            OPTIONAL MATCH (p:Paper)-[:BELONGS_TO]->(t)
            OPTIONAL MATCH (a:Author)-[:AUTHORED]->(p)
            RETURN t, p, a
            LIMIT $limit
            """
            params = {"topic": topic, "limit": limit}
        else:
            cypher = """
            MATCH (p:Paper)
            OPTIONAL MATCH (a:Author)-[:AUTHORED]->(p)
            OPTIONAL MATCH (p)-[:BELONGS_TO]->(t:Topic)
            RETURN p, a, t
            LIMIT $limit
            """
            params = {"limit": limit}
        try:
            records = client.execute_read(cypher, params)
            for rec in records:
                p = rec.get("p")
                a = rec.get("a")
                t = rec.get("t")
                if p:
                    p_title = p.get("title", "")[:80] or p.get("id", "")
                    G.add_node(p_title, type="paper", year=p.get("year", ""), citations=p.get("citations", 0))
                    if a:
                        a_name = a.get("name")
                        if a_name:
                            G.add_node(a_name, type="author")
                            G.add_edge(a_name, p_title, relation="authored")
                    if t:
                        t_name = f"TOPIC:{t.get('name', '')}"
                        G.add_node(t_name, type="topic", label=t.get("name", ""))
                        G.add_edge(t_name, p_title, relation="related")
            
            try:
                scores = nx.degree_centrality(G)
                for n in G.nodes:
                    G.nodes[n]["centrality"] = round(scores.get(n, 0.05), 3)
            except Exception:
                pass
            
            return _node_link(G)
        except Exception:
            pass

    return _node_link(G)
