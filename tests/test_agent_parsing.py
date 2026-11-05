"""
Unit tests for how the research agent reads JSON out of LLM responses.

No database or API key is needed. The cases come from real model output:
reasoning models wrap JSON in prose or code fences and sometimes write
backslashes that are not valid JSON escapes, such as "D\\&D" or LaTeX.
"""
import sys
import os
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from app.agents.research_agent import _safe_json, _repair_escapes, _has_list, _gap_list


class TestLLMJsonParsing(unittest.TestCase):
    def test_invalid_escape_is_repaired(self):
        # shortened from a real gpt-oss-120b comparison that failed to parse
        raw = '{"summary": "ok", "table": [{"aspect": "Dataset", "paper_a": "MUTAG, D\\&D", "paper_b": "-"}]}'
        result = _safe_json(raw, accept=_has_list("table"))
        self.assertIsNotNone(result)
        self.assertEqual(result["table"][0]["paper_a"], "MUTAG, D\\&D")

    def test_latex_backslashes_are_kept_as_text(self):
        result = _safe_json('{"a": "\\alpha_{ij} and \\mathbf{h}"}')
        self.assertEqual(result["a"], "\\alpha_{ij} and \\mathbf{h}")

    def test_valid_escapes_are_not_changed(self):
        raw = '{"a": "tab\\tnew\\nline \\u00e9 quote \\" slash \\\\& end"}'
        self.assertEqual(_repair_escapes(raw), raw)
        self.assertEqual(_safe_json(raw)["a"], 'tab\tnew\nline é quote " slash \\& end')

    def test_object_after_prose_and_fences(self):
        raw = 'Here is the survey, see [1]:\n```json\n{"introduction": "x", "sections": [{"heading": "h", "content": "c"}]}\n```'
        self.assertEqual(_safe_json(raw, accept=_has_list("sections"))["introduction"], "x")

    def test_prose_citation_is_not_taken_as_gap_list(self):
        raw = 'Gaps found in [1] and [2]:\n{"gaps": ["first gap", "second gap"]}'
        gaps = _gap_list(_safe_json(raw, accept=lambda v: _gap_list(v) is not None))
        self.assertEqual(gaps, ["first gap", "second gap"])

    def test_unusable_output_returns_none(self):
        self.assertIsNone(_safe_json("I cannot help with that.", accept=_has_list("phases")))


class TestLLMErrors(unittest.TestCase):
    """Failures from the model call become short LLMError messages (no API call is made)."""

    def _run(self, exc):
        import asyncio
        from unittest import mock
        from langchain_core.prompts import PromptTemplate
        from langchain_core.runnables import RunnableLambda
        from app.agents import research_agent as ra

        def boom(_):
            raise exc

        with mock.patch.object(ra, "_llm", return_value=RunnableLambda(boom)):
            with self.assertRaises(ra.LLMError) as ctx:
                asyncio.run(ra._invoke(PromptTemplate.from_template("{x}"), {"x": "y"}, "Survey generation"))
        return str(ctx.exception)

    def test_rate_limit_message_is_readable(self):
        class RateLimitError(Exception):
            status_code = 429
        msg = self._run(RateLimitError("Error code: 429 - {'error': {'message': 'Rate limit reached ...'}}"))
        self.assertIn("rate limit", msg)
        self.assertNotIn("{", msg)

    def test_other_errors_keep_their_type(self):
        self.assertIn("ValueError", self._run(ValueError("bad")))


if __name__ == "__main__":
    unittest.main()
