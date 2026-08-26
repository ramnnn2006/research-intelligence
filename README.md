# 🔬 ResearchIQ — MCP-Powered Research Intelligence Platform with Neo4j

![Python](https://img.shields.io/badge/Python-3.10+-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-Backend-green)
![React](https://img.shields.io/badge/React-Frontend-61DAFB)
![Groq](https://img.shields.io/badge/Groq-Llama3-purple)
![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-red)
![NetworkX](https://img.shields.io/badge/NetworkX-KnowledgeGraph-orange)
![Neo4j](https://img.shields.io/badge/Neo4j-NoSQL%20Graph%20Database-008CC1)

ResearchIQ is a MCP-powered Research Intelligence Platform that enables researchers, students, and developers to discover, analyze, compare, and understand academic literature using AI and native **Neo4j NoSQL Graph Database** persistence.

The platform leverages the **Model Context Protocol (MCP)** to connect Large Language Models with external research systems such as **ArXiv**, **Semantic Scholar**, and **GitHub**, allowing the AI agent to retrieve real-time research knowledge before generating insights.

By combining MCP servers, Retrieval-Augmented Generation (RAG), Knowledge Graphs, Groq-powered LLMs, and a native **Neo4j Graph Database**, ResearchIQ transforms scattered research information into actionable, interconnected graph intelligence through a single unified interface.

---

# 🚀 Features

### 🔍 Multi-Source Research Discovery

Search across multiple research ecosystems simultaneously:

* ArXiv
* Semantic Scholar
* GitHub Repositories

Features:

* Parallel retrieval
* Paper deduplication
* Metadata enrichment
* Repository discovery
* Unified search experience

---

### 🔌 MCP-Powered Tool Calling

ResearchIQ uses MCP servers to expose external research systems as AI-accessible tools.

Connected MCP Servers:

| MCP Server           | Purpose                              |
| -------------------- | ------------------------------------ |
| ArXiv MCP            | Research paper discovery             |
| Semantic Scholar MCP | Citation and metadata retrieval      |
| GitHub MCP           | Open-source implementation discovery |

Benefits:

* Real-time information retrieval
* Tool-augmented reasoning
* Reduced hallucinations
* Source-grounded outputs
* Extensible architecture

---

### 📊 Neo4j NoSQL Graph Database Persistence

All research interactions, papers, authors, topics, repositories, searches, and generated reports are stored as a highly-connected knowledge graph in **Neo4j**:

* **Paper Nodes**: Stores title, abstract, year, citations, url, and arxiv ID.
* **Author Nodes**: Represents researchers and links via `[:AUTHORED]` to papers.
* **Topic Nodes**: Groups research domains and links via `[:HAS_PAPER]` and `[:COVERS_TOPIC]`.
* **Repository Nodes**: Tracks open-source implementations linked via `[:FOUND_REPO]`.
* **Search & Report Nodes**: Maintains a history of queries and AI synthesis reports connected to their referenced artifacts.

---

### 📚 Literature Review Generator

Automatically generates structured academic literature reviews.

Outputs include:

* Research Background
* Existing Approaches
* Comparative Analysis
* Key Findings
* Limitations
* Future Directions

Powered by Groq Llama 3.3 70B.

---

### 📝 Research Survey Generator

Create comprehensive surveys covering:

* Introduction
* Background
* State of the Art
* Key Methods
* Datasets
* Evaluation Metrics
* Current Trends
* Conclusion

---

### 🎯 Research Gap Detection

Identify:

* Underexplored problems
* Missing evaluations
* Dataset limitations
* Novel opportunities
* Future research directions

---

### 🌐 Interactive Knowledge Graph

Visualize relationships among:

* Papers
* Authors
* Topics
* Citations
* Repositories

Built using D3.js, NetworkX, and Neo4j graph queries.

---

### ⚖️ Paper Comparison Engine

Compare research papers across:

* Problem Statement
* Methodology
* Dataset
* Results
* Novel Contributions
* Limitations

Ideal for literature analysis and academic reviews.

---

### 💬 Chat with Papers

Ask natural language questions about research papers.

Capabilities:

* Context-aware responses
* Paper-grounded reasoning
* Research assistance
* Citation-based answers

Powered by Retrieval-Augmented Generation (RAG).

---

### 🗺️ Research Roadmap Generator

Generate personalized learning roadmaps:

1. Foundations
2. Core Concepts
3. Advanced Topics
4. Research Contributions

Includes relevant papers and implementation repositories.

---

### 🗄️ Research History & Analytics

Stores:

* Searches
* Literature Reviews
* Surveys
* Gap Reports
* Learning Roadmaps

using native **Neo4j Graph Database** persistence with automatic in-memory fallback support.

---

# 🎯 Why MCP?

Traditional AI research assistants rely on static model knowledge and quickly become outdated.

ResearchIQ adopts the **Model Context Protocol (MCP)**, enabling AI agents to interact with live research systems as external tools.

Benefits of MCP:

✅ Real-time paper retrieval

✅ Access to latest publications

✅ Citation-aware reasoning

✅ Repository discovery

✅ Extensible architecture

✅ Reduced hallucinations

✅ Research-grounded outputs

This makes ResearchIQ a true AI research copilot rather than a simple paper summarization system.

---

# 🏗️ Architecture

```text
                          User Query
                               │
                               ▼

                   ┌─────────────────────┐
                   │    React Frontend   │
                   └──────────┬──────────┘
                              │
                              ▼

                   ┌─────────────────────┐
                   │   FastAPI Backend   │
                   └──────────┬──────────┘
                              │
                              ▼

                   ┌─────────────────────┐
                   │ Research AI Agent   │
                   │ Groq Llama 3.3 70B  │
                   └──────────┬──────────┘
                              │

        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼

 ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
 │   ArXiv MCP   │   │ Semantic MCP  │   │  GitHub MCP   │
 │    Server     │   │    Server     │   │    Server     │
 └───────┬───────┘   └───────┬───────┘   └───────┬───────┘
         │                   │                   │
         ▼                   ▼                   ▼

     Research          Citation Data      Open Source
      Papers             Metadata      Implementations

         └───────────────┬────────────────┘
                         ▼

                ┌──────────────────┐
                │ Context Builder  │
                └────────┬─────────┘
                         │

        ┌────────────────┼────────────────┐
        ▼                ▼                ▼

 ┌───────────────┐ ┌───────────────┐ ┌─────────────────┐
 │Knowledge Graph│ │   RAG Store   │ │  Neo4j NoSQL    │
 │  (NetworkX)   │ │Context Engine │ │ Graph Database  │
 └───────┬───────┘ └───────┬───────┘ └────────┬────────┘
         │                 │                  │
         └─────────────────┼──────────────────┘
                           ▼

                 ┌──────────────────┐
                 │ Insight Engine   │
                 └────────┬─────────┘
                          ▼

        Reviews • Surveys • Gaps • Chat • Roadmaps
```

---

# 🕸️ Neo4j Graph Data Model

```text
    (:Author) ──[:AUTHORED]──► (:Paper) ◄──[:FOUND_PAPER]── (:Search)
                                  ▲
                                  │ [:INCLUDES_PAPER]
                                  │
    (:Topic)  ◄──[:COVERS_TOPIC]─ (:Report) ──[:INCLUDES_REPO]──► (:Repository)
       ▲                                                               ▲
       │                                                               │
       └────────────────────────[:HAS_PAPER]───────────────────────────┘
```

### Useful Cypher Queries:

* **Find Top Authors in Knowledge Base**:
  ```cypher
  MATCH (a:Author)-[:AUTHORED]->(p:Paper)
  RETURN a.name AS author, count(p) AS papers_authored
  ORDER BY papers_authored DESC LIMIT 10;
  ```

* **Find Papers connected to a Topic**:
  ```cypher
  MATCH (t:Topic {name: "quantum computing"})-[:HAS_PAPER]->(p:Paper)
  RETURN p.title, p.year, p.citations ORDER BY p.citations DESC;
  ```

* **Inspect Reports & Connected Artifacts**:
  ```cypher
  MATCH (r:Report)-[:INCLUDES_PAPER]->(p:Paper)
  RETURN r.topic, r.report_type, collect(p.title) AS papers;
  ```

---

# 🔄 Research Workflow

```text
Research Topic
      │
      ▼
MCP-Based Paper Discovery
(ArXiv + Semantic Scholar + GitHub)
      │
      ▼
Aggregation & Deduplication
      │
      ▼
Knowledge Graph Construction
      │
      ▼
RAG Context Creation
      │
      ▼
Groq LLM Analysis
      │
      ▼
Review / Survey / Gap Detection
      │
      ▼
Neo4j Graph Database Persistence
      │
      ▼
Interactive Insights & Graph Analytics
```

---

# 📸 Screenshots

## 🏠 Research Discovery

![Research Discovery](screenshots/home-discover.png)

---

## 📦 GitHub Repository Discovery

![GitHub Repository Discovery](screenshots/github-repo-discover.png)

---

## 📚 Literature Review Generator

![Literature Review Generator](screenshots/literature-review-generator.png)

---

## 📄 Research Survey Generation

![Research Survey](screenshots/survey.png)

---

## 🌐 Knowledge Graph Visualization

![Knowledge Graph](screenshots/graph.png)

---

## ⚖️ Paper Comparison

![Paper Comparison](screenshots/paper-compare.png)

---

## 💬 Chat with Papers

![Chat with Papers](screenshots/chat.png)

---

# 🛠️ Tech Stack

| Component        | Technology                          |
| ---------------- | ----------------------------------- |
| Frontend         | React, Vite                         |
| Backend          | FastAPI                             |
| Language         | Python                              |
| LLM              | Llama 3.3 70B                       |
| Inference        | Groq                                |
| Protocol         | Model Context Protocol (MCP)        |
| Knowledge Graph  | NetworkX                            |
| Visualization    | D3.js                               |
| Database (NoSQL) | **Neo4j Graph Database** (Cypher)   |
| APIs             | ArXiv, Semantic Scholar, GitHub     |
| Async Processing | aiohttp                             |
| Validation       | Pydantic                            |
| RAG Engine       | Custom Context Retrieval            |

---

# 📂 Project Structure

```text
research-intelligence-platform/
│
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── agents/
│   │   ├── mcp/
│   │   │   ├── arxiv.py
│   │   │   ├── semantic_scholar.py
│   │   │   └── github.py
│   │   │
│   │   ├── services/
│   │   │   └── graph.py
│   │   ├── rag/
│   │   │   └── vectorstore.py
│   │   └── db/
│   │       ├── database.py
│   │       └── neo4j_client.py
│   │
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── services/
│   │
│   └── package.json
│
├── screenshots/
│   ├── home-discover.png
│   ├── github-repo-discover.png
│   ├── literature-review-generator.png
│   ├── survey.png
│   ├── graph.png
│   ├── paper-compare.png
│   └── chat.png
│
├── docker-compose.yml
├── run.py
├── README.md
├── requirements.txt
├── .env.example
└── .gitignore
```

---

# ⚙️ Installation & Setup

## 1️⃣ Clone Repository

```bash
git clone https://github.com/ramnnn2006/research-intelligence.git

cd research-intelligence
```

---

## 2️⃣ Start Neo4j Graph Database (Docker)

Start Neo4j Community Edition using Docker Compose:

```bash
docker-compose up -d
```

* **Neo4j Browser**: `http://localhost:7474`
* **Bolt Protocol**: `bolt://localhost:7687`
* **Default Credentials**: Username `neo4j`, Password `research123`

*(Note: If Neo4j is not running, the application gracefully operates using built-in in-memory fallback storage).*

---

## 3️⃣ Create Virtual Environment

### Windows

```bash
python -m venv venv

venv\Scripts\activate
```

### Linux / macOS

```bash
python3 -m venv venv

source venv/bin/activate
```

---

## 4️⃣ Install Backend Dependencies

```bash
pip install -r backend/requirements.txt
```

---

## 5️⃣ Install Frontend Dependencies

```bash
cd frontend

npm install

npm run build

cd ..
```

---

## 6️⃣ Configure Environment Variables

Create a `.env` file from the example template:

```bash
cp .env.example .env
```

Set your keys in `.env`:

```env
GROQ_API_KEY=your_groq_api_key
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=research123
NEO4J_DATABASE=neo4j
GITHUB_TOKEN=optional
```

Get a free Groq API key from:
https://console.groq.com

---

## 7️⃣ Run the Application

```bash
python run.py
```

Open:

```text
http://127.0.0.1:8000
```

---

# 💡 Example Use Cases

```text
Generate a literature review on Retrieval-Augmented Generation
```

```text
Find research gaps in Multimodal Large Language Models
```

```text
Compare Vision Transformers and CNN-based architectures
```

```text
Generate a survey on Graph Neural Networks
```

```text
Create a research roadmap for Reinforcement Learning
```

```text
Find GitHub implementations related to Diffusion Models
```

---

# 🎯 Future Enhancements

* Persistent Vector Database
* Citation Network Analysis
* PDF Research Assistant
* Multi-Agent Research Workflows
* Zotero Integration
* CrossRef MCP Integration
* PubMed MCP Integration
* Semantic Search
* BibTeX Export
* LaTeX Report Generation
* Research Recommendation Engine

---

# 👩‍💻 Author

**Raveena V**

B.Tech Computer Science and Engineering

VIT Chennai

---

⭐ If you found this project useful, consider giving it a star.
