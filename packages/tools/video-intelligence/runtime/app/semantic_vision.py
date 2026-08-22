from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class SemanticObservation:
    start_ms: int
    end_ms: int
    text: str
    confidence: float


class SemanticVision:
    """Lazy, GPU-only semantic reading over a small ordered frame set."""

    def __init__(self, enabled: bool, model_name: str, device: str, disabled: bool) -> None:
        self.enabled = enabled and not disabled
        self.model_name = model_name
        self.device = device
        self._model: Any = None
        self._processor: Any = None

    def describe(
        self, frames: list[tuple[int, Any]], brief: dict[str, Any]
    ) -> list[SemanticObservation]:
        if not self.enabled or not frames:
            return []
        try:
            self._load()
            return self._describe(frames, brief)
        except Exception:
            # Object/OCR evidence remains useful when a semantic model cannot
            # be loaded on a constrained worker. Do not fail an entire index.
            return []

    def _load(self) -> None:
        if self._model is not None:
            return
        import torch
        from transformers import AutoProcessor, Qwen2_5_VLForConditionalGeneration

        dtype = torch.bfloat16 if self.device == "cuda" and torch.cuda.is_available() else torch.float32
        self._processor = AutoProcessor.from_pretrained(self.model_name)
        self._model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
            self.model_name,
            torch_dtype=dtype,
            device_map="auto" if self.device == "cuda" and torch.cuda.is_available() else None,
            low_cpu_mem_usage=True,
        )
        if not (self.device == "cuda" and torch.cuda.is_available()):
            self._model.to("cpu")
        self._model.eval()

    def _describe(
        self, frames: list[tuple[int, Any]], brief: dict[str, Any]
    ) -> list[SemanticObservation]:
        import cv2
        import torch
        from PIL import Image

        questions = [str(value).strip() for value in brief.get("expectedQuestions", []) if str(value).strip()]
        focus = str(brief.get("goal") or "").strip()
        prompt = (
            "These are chronological frames from one bounded part of a video. "
            "Describe only facts visibly supported by the frames. Read visible text when clear. "
            "If the frames establish an outcome, state, count, or conclusion, name the evidence; "
            "otherwise explicitly say it is not established. Do not invent context. "
            "Reply as compact JSON with keys summary, supportedClaims, uncertainty."
        )
        if focus:
            prompt += f" Investigation goal: {focus[:1200]}."
        if questions:
            prompt += " Questions to resolve: " + " | ".join(questions[:4])[:1600] + "."
        images = [
            Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            for _, frame in frames
        ]
        content: list[dict[str, Any]] = [
            {"type": "image", "image": image} for image in images
        ] + [{"type": "text", "text": prompt}]
        messages = [{"role": "user", "content": content}]
        text = self._processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = self._processor(
            text=[text], images=images, padding=True, return_tensors="pt"
        ).to(self._model.device)
        with torch.inference_mode():
            generated = self._model.generate(**inputs, max_new_tokens=360, do_sample=False)
        trimmed = [
            output[len(source) :] for source, output in zip(inputs.input_ids, generated)
        ]
        raw = self._processor.batch_decode(
            trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False
        )[0].strip()
        text_value, confidence = _normalize_response(raw)
        if not text_value:
            return []
        return [
            SemanticObservation(
                start_ms=frames[0][0],
                end_ms=frames[-1][0],
                text=text_value,
                confidence=confidence,
            )
        ]


def _normalize_response(raw: str) -> tuple[str, float]:
    value = raw.strip()
    if not value:
        return "", 0.0
    if value.startswith("```"):
        value = value.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return value[:4000], 0.5
    if not isinstance(parsed, dict):
        return value[:4000], 0.5
    summary = str(parsed.get("summary") or "").strip()
    claims = parsed.get("supportedClaims")
    uncertainty = str(parsed.get("uncertainty") or "").strip()
    parts = [summary]
    if isinstance(claims, list):
        parts.extend(str(claim).strip() for claim in claims if str(claim).strip())
    if uncertainty:
        parts.append(f"Uncertainty: {uncertainty}")
    return "\n".join(part for part in parts if part)[:4000], 0.58
