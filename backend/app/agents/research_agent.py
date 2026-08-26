import os, json, re
from langchain_groq import ChatGroq
from langchain_core.prompts import PromptTemplate

def _llm(temp=0.3):
    return ChatGroq(
        model="llama-3.3-70b-versatile",
        groq_api_key=os.getenv("GROQ_API_KEY"),
        temperature=temp,
        max_tokens=2048,
    )

def _safe_json(text: str):
    """Robustly extract JSON from LLM output."""
    text = text.strip()
    # Direct parse
    try:
        return json.loads(text)
    except Exception:
        pass
    # Strip markdown code fences
    m = re.search(r"```(?:json)?\s*([\[\{].*?[\]\}])\s*```", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    # Find first JSON array
    m = re.search(r"(\[.*?\])", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    # Find first JSON object
    m = re.search(r"(\{.*\})", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    return None

def _papers_str(papers: list) -> str:
    lines = []
    for i, p in enumerate(papers[:10]):
        title = p.get('title', 'Unknown')
        year = p.get('year', '')
        summary = (p.get('summary', '') or '')[:200]
        lines.append(f"[{i+1}] {title} ({year}): {summary}")
    return "\n".join(lines)

async def generate_literature_review(topic: str, papers: list) -> str:
    papers_text = _papers_str(papers)
    prompt = PromptTemplate.from_template(
        "You are an expert academic writer. Write a formal literature review (4-5 paragraphs) "
        "on the topic: {topic}\n\n"
        "Papers available:\n{papers}\n\n"
        "Write a coherent review covering background, methods, findings, limitations, and future trends. "
        "Reference papers by number like [1], [2]. Output plain text only, no JSON."
    )
    chain = prompt | _llm()
    try:
        r = await chain.ainvoke({"topic": topic, "papers": papers_text})
        return r.content.strip()
    except Exception as e:
        return f"Error generating review: {e}"

async def detect_research_gaps(topic: str, papers: list) -> list:
    papers_text = _papers_str(papers)
    prompt = PromptTemplate.from_template(
        "You are a research strategist. Identify 5 specific research gaps for: {topic}\n\n"
        "Papers:\n{papers}\n\n"
        "Return ONLY a JSON array of exactly 5 strings. No other text.\n"
        'Example: ["Gap 1", "Gap 2", "Gap 3", "Gap 4", "Gap 5"]'
    )
    chain = prompt | _llm()
    try:
        r = await chain.ainvoke({"topic": topic, "papers": papers_text})
        result = _safe_json(r.content)
        if isinstance(result, list) and len(result) > 0:
            return [str(g) for g in result]
    except Exception:
        pass
    return [
        "Limited evaluation across diverse real-world datasets",
        "Lack of interpretability and explainability in current models",
        "Scalability challenges with large-scale data",
        "Insufficient cross-domain generalization studies",
        "Missing standardized benchmarks for fair comparison",
    ]

async def compare_papers(paper_a: dict, paper_b: dict) -> dict:
    prompt = PromptTemplate.from_template(
        "Compare these two research papers.\n\n"
        "Paper A: {title_a}\nAbstract A: {abstract_a}\n\n"
        "Paper B: {title_b}\nAbstract B: {abstract_b}\n\n"
        "Return ONLY valid JSON with this exact structure:\n"
        '{{"summary":"...","table":[{{"aspect":"Problem","paper_a":"...","paper_b":"..."}},'
        '{{"aspect":"Methodology","paper_a":"...","paper_b":"..."}},'
        '{{"aspect":"Dataset","paper_a":"...","paper_b":"..."}},'
        '{{"aspect":"Results","paper_a":"...","paper_b":"..."}},'
        '{{"aspect":"Limitations","paper_a":"...","paper_b":"..."}},'
        '{{"aspect":"Novelty","paper_a":"...","paper_b":"..."}}],'
        '"winner":"Paper A or Paper B or Tie","reason":"..."}}'
    )
    chain = prompt | _llm()
    try:
        r = await chain.ainvoke({
            "title_a": paper_a.get("title", "Paper A"),
            "abstract_a": (paper_a.get("summary", "") or "")[:500],
            "title_b": paper_b.get("title", "Paper B"),
            "abstract_b": (paper_b.get("summary", "") or "")[:500],
        })
        result = _safe_json(r.content)
        if result and "table" in result:
            return result
    except Exception:
        pass
    return {
        "summary": "Comparison could not be generated. Please try again.",
        "table": [],
        "winner": "N/A",
        "reason": "",
    }

async def generate_survey(topic: str, papers: list) -> dict:
    papers_text = _papers_str(papers)
    prompt = PromptTemplate.from_template(
        "Generate a structured literature survey for: {topic}\n\n"
        "Papers:\n{papers}\n\n"
        "Return ONLY valid JSON:\n"
        '{{"introduction":"2-3 sentence intro about {topic}",'
        '"sections":['
        '{{"heading":"Background and Motivation","content":"paragraph about background"}},'
        '{{"heading":"Key Approaches and Methods","content":"paragraph about methods"}},'
        '{{"heading":"Datasets and Benchmarks","content":"paragraph about datasets"}},'
        '{{"heading":"Recent Trends","content":"paragraph about recent work"}}'
        '],'
        '"conclusion":"2-3 sentence conclusion",'
        '"gaps":["gap1","gap2","gap3"]}}'
    )
    chain = prompt | _llm()
    try:
        r = await chain.ainvoke({"topic": topic, "papers": papers_text})
        result = _safe_json(r.content)
        if result and "sections" in result:
            return result
    except Exception:
        pass
    return {
        "introduction": f"This survey covers recent advances in {topic}.",
        "sections": [{"heading": "Overview", "content": "Survey generation failed — please retry."}],
        "conclusion": "Please retry the survey generation.",
        "gaps": [],
    }

async def answer_question(question: str, papers: list) -> str:
    context = _papers_str(papers) if papers else "No papers loaded yet."
    prompt = PromptTemplate.from_template(
        "You are a helpful research assistant.\n\n"
        "Available papers:\n{context}\n\n"
        "Question: {question}\n\n"
        "Give a clear, well-structured answer. Cite papers as [1], [2] etc. "
        "If no papers are relevant, answer from your general knowledge."
    )
    chain = prompt | _llm(temp=0.4)
    try:
        r = await chain.ainvoke({"context": context, "question": question})
        return r.content.strip()
    except Exception as e:
        return f"Could not answer: {e}"

async def generate_roadmap(topic: str, papers: list) -> dict:
    # Embed actual URLs in the paper list so they come back in the JSON
    papers_text = "\n".join(
        f"[{i+1}] title: \"{p.get('title','?')}\" | url: \"{p.get('url') or p.get('id','')}\""
        f" | year: {p.get('year','')} | authors: {', '.join((p.get('authors') or [])[:2])}"
        for i, p in enumerate(papers[:12])
    )
    prompt = PromptTemplate.from_template(
        "Create a research learning roadmap for: {topic}\n\n"
        "Available papers (copy titles and URLs exactly as shown):\n{papers}\n\n"
        "Return ONLY valid JSON. Each paper entry in phases must be an object with 'title' and 'url'.\n"
        '{{"overview":"2 sentence overview",'
        '"phases":['
        '{{"phase":"Phase 1: Foundations","duration":"2-4 weeks","tasks":["task1","task2"],'
        '"papers":[{{"title":"exact title from list","url":"exact url from list"}}]}},'
        '{{"phase":"Phase 2: Core Methods","duration":"4-6 weeks","tasks":["task1","task2"],'
        '"papers":[{{"title":"exact title","url":"exact url"}}]}},'
        '{{"phase":"Phase 3: Advanced Topics","duration":"4-8 weeks","tasks":["task1","task2"],'
        '"papers":[{{"title":"exact title","url":"exact url"}}]}},'
        '{{"phase":"Phase 4: Research Contribution","duration":"ongoing","tasks":["task1","task2"],'
        '"papers":[]}}'
        '],'
        '"key_skills":["skill1","skill2","skill3","skill4"],'
        '"resources":["resource1","resource2"]}}'
    )
    chain = prompt | _llm()
    try:
        r = await chain.ainvoke({"topic": topic, "papers": papers_text})
        result = _safe_json(r.content)
        if result and "phases" in result:
            return result
    except Exception:
        pass
    return {
        "overview": f"A structured path to mastering {topic}.",
        "phases": [], "key_skills": [], "resources": [],
    }

