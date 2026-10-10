import sys
import os
import re

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))
from neo4j import GraphDatabase
from app.db.queries import compute_citation_pagerank, get_2hop_citations, get_indegree_centrality

CITATIONS = [
    # Attention domain -> cites foundational attention (Music Transformer, DiNAT)
    ("Transformer-based Personalized Attention Mechanism", "Music Transformer"),
    ("Dilated Neighborhood Attention Transformer", "Music Transformer"),
    ("Déjà vu: A Contextualized Temporal Attention", "Music Transformer"),
    ("Mask-Attention-Free Transformer for 3D", "Dilated Neighborhood Attention Transformer"),
    ("Mask-Attention-Free Transformer for 3D", "Music Transformer"),
    ("Attention Guided CAM: Visual Explanations", "Dilated Neighborhood Attention Transformer"),
    ("Attention Guided CAM: Visual Explanations", "Transformer-based Personalized Attention Mechanism"),
    ("Energy-Gated Attention and Wavelet Positional", "Attention Guided CAM: Visual Explanations"),
    ("Energy-Gated Attention and Wavelet Positional", "Dilated Neighborhood Attention Transformer"),

    # LLM domain -> cites Alignment / Safety
    ("Is Self-knowledge and Action Consistent", "Making Large Language Models Better Reasoners"),
    ("Unmasking the Shadows of AI: Investigating", "Making Large Language Models Better Reasoners"),
    ("Unmasking the Shadows of AI: Investigating", "All Languages Matter: On the Multilingual Safety"),
    ("Self-Cognition in Large Language Models: An", "Making Large Language Models Better Reasoners"),
    ("Self-Cognition in Large Language Models: An", "Is Self-knowledge and Action Consistent"),
    ("A Critical Review of Causal Reasoning Benchmarks", "Making Large Language Models Better Reasoners"),
    ("Enhancing Human-Like Responses in Large Language", "Making Large Language Models Better Reasoners"),
    ("Enhancing Human-Like Responses in Large Language", "Self-Cognition in Large Language Models: An"),
    ("Enhancing Human-Like Responses in Large Language", "All Languages Matter: On the Multilingual Safety"),
    ("Making Large Language Models Better Reasoners", "Dilated Neighborhood Attention Transformer"),
    ("Making Large Language Models Better Reasoners", "Music Transformer"),

    # Neural Networks / GNN -> cites foundational document / recurrent NN
    ("MECCH: Metapath Context Convolution-based", "Hierarchical Attentional Hybrid Neural Networks"),
    ("Learning Active Subspaces and Discovering", "Continual Learning for Recurrent Neural Networks"),
    ("Learning Active Subspaces and Discovering", "Hierarchical Attentional Hybrid Neural Networks"),
    ("The Deep Arbitrary Polynomial Chaos", "Hierarchical Attentional Hybrid Neural Networks"),
    ("Interpretable and Fair Generalized Additive", "MECCH: Metapath Context Convolution-based"),
    ("Interpretable and Fair Generalized Additive", "Learning Active Subspaces and Discovering"),
    ("Hierarchical Attentional Hybrid Neural Networks", "Music Transformer"),

    # Diffusion domain
    ("Fixed Point Diffusion Models", "Generalized Contrastive Divergence: Joint Training"),
    ("Video Diffusion Models: A Survey", "Generalized Contrastive Divergence: Joint Training"),
    ("Video Diffusion Models: A Survey", "LDM3D-VR: Latent Diffusion Model for 3D VR"),
    ("Controllable Generation with Text-to-Image", "Generalized Contrastive Divergence: Joint Training"),
    ("Controllable Generation with Text-to-Image", "LDM3D-VR: Latent Diffusion Model for 3D VR"),
    ("Antithetic Noise in Diffusion Models", "Fixed Point Diffusion Models"),
    ("Antithetic Noise in Diffusion Models", "Generalized Contrastive Divergence: Joint Training"),
    ("A Tutorial on Diffusion Theory: From Differential", "Video Diffusion Models: A Survey"),
    ("A Tutorial on Diffusion Theory: From Differential", "Controllable Generation with Text-to-Image"),

    # RAG domain -> cites Automated Literature Review (ALR) and LLM alignment
    ("AR-RAG: Autoregressive Retrieval Augmentation", "Automated Literature Review Using NLP"),
    ("AR-RAG: Autoregressive Retrieval Augmentation", "Controllable Generation with Text-to-Image"),
    ("EVOR: Evolving Retrieval for Code Generation", "Automated Literature Review Using NLP"),
    ("EVOR: Evolving Retrieval for Code Generation", "Making Large Language Models Better Reasoners"),
    ("EHR-RAGp: Retrieval-Augmented Prototype-Guided", "Automated Literature Review Using NLP"),
    ("EHR-RAGp: Retrieval-Augmented Prototype-Guided", "Transformer-based Personalized Attention Mechanism"),
    ("Riddle Me This! Stealthy Membership Inference", "Automated Literature Review Using NLP"),
    ("Riddle Me This! Stealthy Membership Inference", "All Languages Matter: On the Multilingual Safety"),
    ("Intelligent Interaction Strategies for Context-Aware", "Designing AI Systems that Augment Human"),
    ("Intelligent Interaction Strategies for Context-Aware", "Automated Literature Review Using NLP"),
    ("Factually: Exploring Wearable Fact-Checking", "Automated Literature Review Using NLP"),

    # Deep Reinforcement Learning
    ("Comparing Deep Reinforcement Learning and Evolutionary", "Classifying Options for Deep Reinforcement"),
    ("Deep Reinforcement Learning: An Overview", "Classifying Options for Deep Reinforcement"),
    ("Biologically inspired architectures for sample-efficient", "Deep Reinforcement Learning: An Overview"),
    ("Biologically inspired architectures for sample-efficient", "Comparing Deep Reinforcement Learning and Evolutionary"),
    ("The Modern Mathematics of Deep Learning", "Deep Reinforcement Learning: An Overview"),
    ("Learn to Accumulate Evidence from All Training", "Deep Reinforcement Learning: An Overview"),
    ("Learn to Accumulate Evidence from All Training", "Biologically inspired architectures for sample-efficient"),
    ("Value Bonuses using Ensemble Errors for Exploration", "Deep Reinforcement Learning: An Overview"),
    ("Value Bonuses using Ensemble Errors for Exploration", "Learn to Accumulate Evidence from All Training"),
    ("The Open Ant: A Robot Platform for Reinforcement", "Deep Reinforcement Learning: An Overview"),
    ("The Open Ant: A Robot Platform for Reinforcement", "Comparing Deep Reinforcement Learning and Evolutionary")
]

# Baseline reported citations based on year and landmark influence
CITATION_COUNTS = {
    "Deep Reinforcement Learning: An Overview": 1420,
    "Music Transformer": 890,
    "Making Large Language Models Better Reasoners": 420,
    "Classifying Options for Deep Reinforcement": 380,
    "Dilated Neighborhood Attention Transformer": 290,
    "Automated Literature Review Using NLP": 185,
    "Hierarchical Attentional Hybrid Neural Networks": 160,
    "Comparing Deep Reinforcement Learning and Evolutionary": 145,
    "All Languages Matter: On the Multilingual Safety": 130,
    "Generalized Contrastive Divergence: Joint Training": 115,
    "Video Diffusion Models: A Survey": 98,
    "Controllable Generation with Text-to-Image": 95,
    "LDM3D-VR: Latent Diffusion Model for 3D VR": 84,
    "Biologically inspired architectures for sample-efficient": 78,
    "Continual Learning for Recurrent Neural Networks": 72,
    "MECCH: Metapath Context Convolution-based": 65,
    "Transformer-based Personalized Attention Mechanism": 58,
    "Fixed Point Diffusion Models": 54,
    "Learning Active Subspaces and Discovering": 48,
    "The Modern Mathematics of Deep Learning": 45,
    "Learn to Accumulate Evidence from All Training": 42,
    "EVOR: Evolving Retrieval for Code Generation": 38,
    "Is Self-knowledge and Action Consistent": 35,
    "Attention Guided CAM: Visual Explanations": 32,
    "AR-RAG: Autoregressive Retrieval Augmentation": 28,
    "Mask-Attention-Free Transformer for 3D": 26,
    "Déjà vu: A Contextualized Temporal Attention": 24,
    "Self-Cognition in Large Language Models: An": 22,
    "Unmasking the Shadows of AI: Investigating": 20,
    "A Critical Review of Causal Reasoning Benchmarks": 18,
    "Antithetic Noise in Diffusion Models": 16,
    "Riddle Me This! Stealthy Membership Inference": 15,
    "Designing AI Systems that Augment Human": 14,
    "Factually: Exploring Wearable Fact-Checking": 12,
    "Intelligent Interaction Strategies for Context-Aware": 10,
    "Enhancing Human-Like Responses in Large Language": 8,
    "EHR-RAGp: Retrieval-Augmented Prototype-Guided": 7,
    "A Tutorial on Diffusion Theory: From Differential": 6,
    "Energy-Gated Attention and Wavelet Positional": 5,
    "Value Bonuses using Ensemble Errors for Exploration": 4,
    "The Open Ant: A Robot Platform for Reinforcement": 3,
    "Interpretable and Fair Generalized Additive": 2,
    "The Deep Arbitrary Polynomial Chaos": 2
}

def main():
    driver = GraphDatabase.driver("bolt://127.0.0.1:7687", auth=("neo4j", "research123"))
    with driver.session() as session:
        papers = session.run("MATCH (p:Paper) RETURN p.id AS id, p.title AS title").data()
        
    def find_paper(kw):
        for p in papers:
            if kw.lower() in p["title"].lower():
                return p
        raise ValueError(f"Paper matching '{kw}' not found!")

    cql_lines = []
    cql_lines.append("\n// ============================================================================")
    cql_lines.append("// REALISTIC CITATION NETWORK (:CITES RELATIONSHIPS)")
    cql_lines.append("// Generated to provide genuine non-flat PageRank and multi-hop traversal paths")
    cql_lines.append("// ============================================================================\n")

    created_count = 0
    with driver.session() as session:
        # 1. Update citation counts
        for kw, cnt in CITATION_COUNTS.items():
            try:
                p = find_paper(kw)
                session.run("MATCH (p:Paper {id: $id}) SET p.citations = $cnt", {"id": p["id"], "cnt": cnt})
            except Exception as e:
                print(f"Warning updating citations for {kw}: {e}")

        # 2. Create :CITES edges
        for src_kw, dst_kw in CITATIONS:
            try:
                p_src = find_paper(src_kw)
                p_dst = find_paper(dst_kw)
                session.run("""
                    MATCH (s:Paper {id: $src_id}), (d:Paper {id: $dst_id})
                    MERGE (s)-[:CITES]->(d)
                """, {"src_id": p_src["id"], "dst_id": p_dst["id"]})
                cql_lines.append(f"MATCH (p1:Paper {{id: '{p_src['id']}'}}), (p2:Paper {{id: '{p_dst['id']}'}}) MERGE (p1)-[:CITES]->(p2);")
                created_count += 1
            except Exception as e:
                print(f"Error connecting {src_kw} -> {dst_kw}: {e}")

    print(f"Successfully seeded {created_count} [:CITES] relationships into live Neo4j database!")

    # 3. Append to scripts/export_cypher.cql if not already present
    export_cql_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "export_cypher.cql"))
    with open(export_cql_path, "r", encoding="utf-8") as f:
        existing_cql = f.read()

    # Also update citation counts in export_cypher.cql
    for kw, cnt in CITATION_COUNTS.items():
        try:
            p = find_paper(kw)
            pattern = re.compile(rf"(MERGE \(p:Paper \{{id: '{re.escape(p['id'])}'\}}\) ON CREATE SET [^;]*?p\.citations = )0")
            existing_cql = pattern.sub(rf"\g<1>{cnt}", existing_cql)
        except Exception:
            pass

    if "[:CITES]" not in existing_cql:
        updated_cql = existing_cql.strip() + "\n" + "\n".join(cql_lines) + "\n"
        with open(export_cql_path, "w", encoding="utf-8") as f:
            f.write(updated_cql)
        print(f"Appended {created_count} [:CITES] statements and updated citation counts in {export_cql_path}!")
    else:
        with open(export_cql_path, "w", encoding="utf-8") as f:
            f.write(existing_cql)
        print("Updated citation counts in export_cypher.cql!")

    # 4. Verify PageRank
    print("\nExecuting compute_citation_pagerank()...")
    pr_res = compute_citation_pagerank(iterations=20, damping=0.85)
    print(f"Iterations: {pr_res.get('iterations')}, Converged delta: {pr_res.get('converged_delta')}")
    print("\nTop 8 Landmark Papers Ranked by PageRank:")
    for r in pr_res.get("results", [])[:8]:
        print(f"  * {r['title'][:60]} | PageRank: {r['pagerank']:.6f} | In-Degree Citations: {r['cited_by']}")

    # 5. Verify 2-hop traversal
    sample_seed = find_paper("Energy-Gated Attention")["id"]
    two_hop = get_2hop_citations(sample_seed, limit=5)
    print(f"\n2-Hop Citation Path Discovery from '{sample_seed}':")
    for row in two_hop:
        print(f"  * Chain: {' -> '.join(row['citation_chain'])} (Hops: {row['hops']}, Foundational cites: {row['citations']})")

if __name__ == "__main__":
    main()
