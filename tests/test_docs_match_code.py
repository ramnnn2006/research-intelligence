import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.agents.research_agent import DEFAULT_GROQ_MODEL

MODEL_NAME = re.compile(r"\b(?:llama|gpt-oss|mixtral|gemma|qwen)[\w.\-]*", re.I)


def uses_mcp_sdk():
    pattern = re.compile(r"^\s*(?:import|from)\s+mcp\b", re.M)
    sources = (p.read_text(encoding="utf-8-sig") for p in (ROOT / "backend").rglob("*.py"))
    return any(pattern.search(text) for text in sources) or "mcp" in (ROOT / "requirements.txt").read_text().lower().split()


def doc_problems(readme_text):
    problems = []
    if not uses_mcp_sdk():
        for n, line in enumerate(readme_text.splitlines(), 1):
            if re.search(r"(?i:model context protocol)|\bMCP\b", line) and "do not use" not in line and "backend/app/mcp" not in line:
                problems.append(f"README:{n} claims MCP but no MCP SDK is imported; the connectors are plain HTTP clients")
    default = DEFAULT_GROQ_MODEL.lower()
    for n, line in enumerate(readme_text.splitlines(), 1):
        for name in MODEL_NAME.findall(line):
            if name.lower().strip("`.,") not in default:
                problems.append(f"README:{n} names model {name} but the code default is {DEFAULT_GROQ_MODEL}")
    return problems


def test_readme_claims_match_code():
    problems = doc_problems((ROOT / "README.md").read_text(encoding="utf-8"))
    assert not problems, "Update README to match the code (or change the code):\n" + "\n".join(problems)
