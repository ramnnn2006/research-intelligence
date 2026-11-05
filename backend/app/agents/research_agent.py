import os, json, re, asyncio
from typing import Any, Callable, Dict, Iterator, Optional
from langchain_groq import ChatGroq
from langchain_core.prompts import PromptTemplate
from app.mcp.crossref import CrossRefMCP
from app.mcp.pubmed import PubMedMCP

crossref = CrossRefMCP()
pubmed   = PubMedMCP()


class LLMError(RuntimeError):
    """The LLM call failed or returned output that could not be used. Routes map it to HTTP 502."""


def _env_token(name: str) -> str:
    """Env value, treating blanks and .env.example placeholders (your_..., optional) as unset."""
    value = os.getenv(name, "").strip()
    return "" if not value or value.lower().startswith(("your_", "optional")) else value


DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b"


def _llm(temp=0.3):
    key = _env_token("GROQ_API_KEY")
    if not key:
        raise LLMError("GROQ_API_KEY is not set")
    return ChatGroq(
        model=os.getenv("GROQ_MODEL", "").strip() or DEFAULT_GROQ_MODEL,
        groq_api_key=key,
        temperature=temp,
        max_tokens=2048,
    )


async def _invoke(prompt: PromptTemplate, variables: Dict[str, Any], what: str, temp: float = 0.3) -> str:
    """Run prompt | llm and return the text, raising LLMError with a short message on any failure."""
    try:
        chain = prompt | _llm(temp)
        r = await chain.ainvoke(variables)
        text = r.content if isinstance(r.content, str) else str(r.content or "")
    except LLMError as e:
        raise LLMError(f"{what} failed: {e}") from e
    except Exception as e:
        raise LLMError(f"{what} failed: {type(e).__name__}: {str(e)[:200]}") from e
    if not text.strip():
        raise LLMError(f"{what} failed: the model returned an empty response")
    return text


def _json_candidates(text: str) -> Iterator[Any]:
    """
    Every JSON value we can find in LLM output, most likely first: the whole
    text, fenced code blocks, then the outermost object and only after that
    arrays. Arrays come last because prose such as "see [1]" is valid JSON.
    """
    stripped = text.strip()
    try:
        yield json.loads(stripped)
    except ValueError:
        pass
    for block in re.findall(r"```(?:json)?\s*(.*?)```", text, re.DOTALL):
        try:
            yield json.loads(block.strip())
        except ValueError:
            pass
    decoder = json.JSONDecoder()
    for opener in "{[":
        start = text.find(opener)
        while start != -1:
            try:
                yield decoder.raw_decode(text, start)[0]
            except ValueError:
                pass
            start = text.find(opener, start + 1)


def _safe_json(text: str, accept: Optional[Callable[[Any], bool]] = None):
    """Extract JSON from LLM output; returns the first value `accept` allows, or None."""
    for value in _json_candidates(text or ""):
        if accept is None or accept(value):
            return value
    return None


def _has_list(key: str) -> Callable[[Any], bool]:
    return lambda v: isinstance(v, dict) and isinstance(v.get(key), list)


def _gap_list(value: Any):
    if isinstance(value, dict):
        value = value.get("gaps") or value.get("research_gaps")
    if not isinstance(value, list):
        return None
    gaps = [g.strip() for g in value if isinstance(g, str) and g.strip()]
    return gaps or None


def _papers_str(papers: list) -> str:
    lines = []
    for i, p in enumerate(papers[:10]):
        title = p.get('title', 'Unknown')
        year = p.get('year', '')
        summary = (p.get('summary', '') or '')[:200]
        lines.append(f"[{i+1}] {title} ({year}): {summary}")
    return "\n".join(lines)

async def top_up_papers(topic: str, papers: list, min_papers: int = 6) -> list:
    """ArXiv/Scholar sometimes return very little (rate limits, niche or biomedical
    topics). Fill the gap from CrossRef and PubMed so the LLM has something to cite.
    Routes call this before the generators so the list they return and save is
    exactly the list the model was shown (and cites as [1], [2], ...)."""
    if len(papers) >= min_papers:
        return papers
    extra = await asyncio.gather(crossref.search(topic, 5), pubmed.search(topic, 5))
    seen = {(p.get("title") or "").lower()[:60] for p in papers}
    out = list(papers)
    for p in (p for lst in extra for p in lst):
        k = (p.get("title") or "").lower()[:60]
        if k and k not in seen:
            seen.add(k); out.append(p)
    return out

async def generate_literature_review(topic: str, papers: list) -> str:
    papers_text = _papers_str(papers)
    prompt = PromptTemplate.from_template(
        "You are an expert academic writer. Write a formal literature review (4-5 paragraphs) "
        "on the topic: {topic}\n\n"
        "Papers available:\n{papers}\n\n"
        "Write a coherent review covering background, methods, findings, limitations, and future trends. "
        "Reference papers by number like [1], [2]. Output plain text only, no JSON."
    )
    text = await _invoke(prompt, {"topic": topic, "papers": papers_text}, "Literature review generation")
    return text.strip()

async def detect_research_gaps(topic: str, papers: list) -> list:
    papers_text = _papers_str(papers)
    prompt = PromptTemplate.from_template(
        "You are a research strategist. Identify 5 specific research gaps for: {topic}\n\n"
        "Papers:\n{papers}\n\n"
        "Return ONLY a JSON array of exactly 5 strings. No other text.\n"
        'Example: ["Gap 1", "Gap 2", "Gap 3", "Gap 4", "Gap 5"]'
    )
    text = await _invoke(prompt, {"topic": topic, "papers": papers_text}, "Research gap detection")
    gaps = _gap_list(_safe_json(text, accept=lambda v: _gap_list(v) is not None))
    if not gaps:
        raise LLMError("Research gap detection failed: the model did not return a JSON list of gaps")
    return gaps

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
    text = await _invoke(prompt, {
        "title_a": paper_a.get("title", "Paper A"),
        "abstract_a": (paper_a.get("summary") or paper_a.get("abstract") or "")[:500],
        "title_b": paper_b.get("title", "Paper B"),
        "abstract_b": (paper_b.get("summary") or paper_b.get("abstract") or "")[:500],
    }, "Paper comparison")
    result = _safe_json(text, accept=_has_list("table"))
    if result is None:
        raise LLMError("Paper comparison failed: the model did not return the comparison JSON")
    return result

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
    text = await _invoke(prompt, {"topic": topic, "papers": papers_text}, "Survey generation")
    result = _safe_json(text, accept=_has_list("sections"))
    if result is None:
        raise LLMError("Survey generation failed: the model did not return the survey JSON")
    return result

async def answer_question(question: str, papers: list) -> str:
    context = _papers_str(papers) if papers else "No papers loaded yet."
    prompt = PromptTemplate.from_template(
        "You are a helpful research assistant.\n\n"
        "Available papers:\n{context}\n\n"
        "Question: {question}\n\n"
        "Give a clear, well-structured answer. Cite papers as [1], [2] etc. "
        "If no papers are relevant, answer from your general knowledge."
    )
    text = await _invoke(prompt, {"context": context, "question": question}, "Question answering", temp=0.4)
    return text.strip()

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
    text = await _invoke(prompt, {"topic": topic, "papers": papers_text}, "Roadmap generation")
    result = _safe_json(text, accept=_has_list("phases"))
    if result is None:
        raise LLMError("Roadmap generation failed: the model did not return the roadmap JSON")
    return result
