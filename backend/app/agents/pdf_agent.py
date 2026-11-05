"""
Question answering over excerpts of loaded PDFs, with page citations.

answer_pdf_question raises when the language model call fails; the API layer
turns that into a 502 instead of returning an error message as an answer.
"""
import logging
from typing import Any, Dict, List

from langchain_core.prompts import PromptTemplate

logger = logging.getLogger("research_iq.pdf_agent")

MAX_CONTEXT_CHARS = 12000

_PROMPT = PromptTemplate.from_template(
    "You are a research scientist reading a paper in depth.\n\n"
    "Excerpts extracted from the PDF pages:\n{context}\n\n"
    "Question: {question}\n\n"
    "Instructions:\n"
    "1. Give a thorough, precise and well structured answer.\n"
    "2. For every fact, formula, result or concept, cite the page like [Page 3] or [Page 7].\n"
    "3. Base the answer strictly on the excerpts. If they do not contain the answer, say so explicitly."
)


def _context(chunks: List[Dict[str, Any]]) -> str:
    parts, used = [], 0
    for c in chunks:
        block = f"--- [Page {c.get('page')}] ({c.get('paper', 'PDF')}) ---\n{c.get('text', '')}"
        if used + len(block) > MAX_CONTEXT_CHARS and parts:
            break
        parts.append(block)
        used += len(block)
    return "\n\n".join(parts)


async def answer_pdf_question(question: str, chunks: List[Dict[str, Any]]) -> str:
    if not chunks:
        return "No relevant sections found in the loaded PDF."
    try:
        from app.agents.research_agent import _llm
        chain = _PROMPT | _llm(temp=0.2)
        result = await chain.ainvoke({"context": _context(chunks), "question": question})
        return (result.content or "").strip()
    except Exception as e:
        if type(e).__name__ == "LLMError":  # configuration problems such as a missing key: no traceback
            logger.warning("PDF question answering unavailable: %s", e)
        else:
            logger.exception("PDF question answering failed")
        raise
