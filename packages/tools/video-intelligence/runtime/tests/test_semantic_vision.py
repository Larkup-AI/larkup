from __future__ import annotations

import unittest

from app.semantic_vision import _normalize_response


class SemanticVisionTests(unittest.TestCase):
    def test_keeps_structured_claims_and_uncertainty_as_retrievable_text(self) -> None:
        text, confidence = _normalize_response(
            '{"summary":"The screen shows a final announcement.",'
            '"supportedClaims":["A result is displayed."],'
            '"uncertainty":"The winner name is not legible."}'
        )

        self.assertIn("The screen shows a final announcement.", text)
        self.assertIn("A result is displayed.", text)
        self.assertIn("winner name is not legible", text)
        self.assertGreater(confidence, 0)

    def test_preserves_non_json_model_output_without_dropping_evidence(self) -> None:
        text, confidence = _normalize_response("No final outcome is visibly established.")

        self.assertEqual(text, "No final outcome is visibly established.")
        self.assertEqual(confidence, 0.5)


if __name__ == "__main__":
    unittest.main()
