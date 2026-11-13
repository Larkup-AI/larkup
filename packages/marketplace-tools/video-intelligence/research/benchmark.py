"""Dependency-free, label-blind adapter runner for video multiple-choice evaluation."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import time


DATASETS = ("video-mme", "longvideobench", "mlvu", "egoschema")


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        fingerprint = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            fingerprint.update(block)
        return fingerprint.hexdigest()


def answer_index(value, choices: list[str]) -> int:
    if isinstance(value, int) and not isinstance(value, bool) and 0 <= value < len(choices):
        return value
    if isinstance(value, str):
        value = value.strip()
        if value in choices:
            return choices.index(value)
        if len(value) == 1 and "A" <= value <= chr(64 + len(choices)):
            return ord(value) - 65
    raise ValueError("Answer must be an exact option, uppercase letter, or zero-based integer")


def prepare(dataset: str, rows: list[dict], media_root: Path, split: str,
            labels: dict | None = None, task: str = "multiple-choice") -> list[dict]:
    """Normalize public labeled MCQ subsets; reject hidden or ambiguous labels."""
    if dataset not in DATASETS:
        raise ValueError("Unsupported dataset")
    cases = []
    hashes = {}
    media_root = media_root.resolve()
    for row in rows:
        questions = row["questions"] if dataset == "video-mme" else [row]
        for ordinal, question in enumerate(questions):
            if dataset == "video-mme":
                video = str(row["videoID"]) + ".mp4"
                uid = question["question_id"]
                options = question["options"]
                answer = question.get("answer")
            elif dataset == "longvideobench":
                video, uid = row["video_path"], row["id"]
                options, answer = row["candidates"], row.get("correct_choice")
            elif dataset == "mlvu":
                video = row["video"]
                uid = row.get("question_id", str(video) + ":" + str(len(cases)))
                options, answer = row["candidates"], row.get("answer")
            else:
                uid = row["q_uid"]
                video = str(uid) + ".mp4"
                options = [row[f"option {i}"] for i in range(5)]
                answer = (labels or {}).get(str(uid))
            if not 2 <= len(options) <= 26 or not all(isinstance(v, str) for v in options):
                raise ValueError("MCQ options must contain between 2 and 26 strings")
            if answer is None:
                raise ValueError("Hidden labels require the official evaluation server")
            path = (media_root / video).resolve()
            if not path.is_relative_to(media_root):
                raise ValueError("Media path must remain within the media root")
            if path not in hashes:
                hashes[path] = digest(path)
            cases.append({
                "id": f"{dataset}:{split}:{task}:{uid}", "dataset": dataset,
                "split": split, "task": task, "question": question["question"],
                "options": options, "answer": answer_index(answer, options),
                "media": {"path": str(path), "sha256": hashes[path]},
            })
    if len({case["id"] for case in cases}) != len(cases):
        raise ValueError("Duplicate question identifiers")
    return cases


def finite_metric(response: dict, key: str):
    value = response.get(key)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ValueError(f"Invalid metric: {key}")
    return value


def run_case(case: dict, command: list[str], timeout: float, protocol: dict) -> dict:
    # An explicit allowlist prevents future evaluator fields from leaking labels.
    public = {key: case[key] for key in ("id", "question", "options", "media")}
    started = time.perf_counter()
    process = subprocess.run(command, input=json.dumps({"case": public, "protocol": protocol}),
                             text=True, capture_output=True, timeout=timeout, check=False)
    elapsed = time.perf_counter() - started
    if process.returncode:
        # Adapter stderr may contain provider headers or keys; do not publish it.
        raise RuntimeError("Adapter process failed; evaluation stopped before correctness scoring")
    response = json.loads(process.stdout)
    if not isinstance(response, dict) or response.get("status") != "ok":
        raise RuntimeError("Adapter infrastructure failure; evaluation stopped")
    try:
        prediction = answer_index(response.get("prediction"), case["options"])
    except ValueError:
        prediction = -1
    metrics = {key: finite_metric(response, key) for key in (
        "indexCostUsd", "queryCostUsd", "indexSeconds", "querySeconds", "ttfbSeconds",
        "framesInspected", "modelCalls", "peakRssBytes",
    )}
    total_cost = (metrics["indexCostUsd"] + metrics["queryCostUsd"]
                  if metrics["indexCostUsd"] is not None and metrics["queryCostUsd"] is not None else None)
    return {"id": case["id"], "dataset": case["dataset"], "split": case["split"],
            "task": case["task"], "sourceSha256": case["media"]["sha256"],
            "prediction": prediction, "correct": int(prediction == case["answer"]),
            "wallSeconds": elapsed, "totalCostUsd": total_cost, **metrics}


def report(rows: list[dict], output: Path, metadata: dict) -> None:
    if not rows:
        raise ValueError("No completed cases to publish")
    output.mkdir(parents=True, exist_ok=True)
    with (output / "results.csv").open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    correct = sum(row["correct"] for row in rows)
    costs_known = all(row["totalCostUsd"] is not None for row in rows)
    cost = sum(row["totalCostUsd"] for row in rows) if costs_known else None
    total = f"${cost:.6f}" if cost is not None else "unknown (incomplete billing ledger)"
    per_pass = f"${cost / correct:.6f}" if cost is not None and correct else "not available"
    groups = {}
    for row in rows:
        key = (row["dataset"], row["split"], row["task"])
        groups.setdefault(key, []).append(row)
    table = "\n".join(f"| {' / '.join(key)} | {sum(r['correct'] for r in group)}/{len(group)} |"
                      for key, group in sorted(groups.items()))
    data = output / "data"
    data.mkdir(exist_ok=True)
    (data / "protocol.json").write_text(json.dumps(metadata, indent=2) + "\n")
    (output / "blog.md").write_text(
        "# Video understanding measurement\n\n"
        f"Exact-choice accuracy: {correct}/{len(rows)}. Measured adapter wall time: "
        f"{sum(row['wallSeconds'] for row in rows):.3f}s. Total cost: {total}. "
        f"Cost per verified pass: {per_pass}.\n\n"
        "| Dataset / split / task | Correct |\n|---|---|\n" + table + "\n\n"
        "These are local harness measurements, not official leaderboard submissions. "
        "Wall time includes process startup; provider-reported index, query and TTFB "
        "metrics are separate columns. Blank metrics are unknown, never zero. "
        "No cross-system superiority claim follows from this run. "
        "Record cold/warm state, subtitles, source preparation, hardware, all model versions, "
        "and complete billing (including uploads, compute and storage) in data/protocol.json. "
        "Multiple-choice accuracy does not establish exhaustive extraction or rare-event recall.\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    prep = sub.add_parser("prepare")
    prep.add_argument("--dataset", choices=DATASETS, required=True)
    prep.add_argument("--annotations", type=Path, required=True)
    prep.add_argument("--media-root", type=Path, required=True)
    prep.add_argument("--labels", type=Path)
    prep.add_argument("--split", required=True)
    prep.add_argument("--task", default="multiple-choice")
    prep.add_argument("--output", type=Path, required=True)
    run = sub.add_parser("run")
    run.add_argument("--cases", type=Path, required=True)
    run.add_argument("--protocol", type=Path, required=True)
    run.add_argument("--output", type=Path, required=True)
    run.add_argument("--timeout", type=float, default=600)
    run.add_argument("--adapter", nargs=argparse.REMAINDER, required=True)
    args = parser.parse_args()
    if args.action == "prepare":
        cases = prepare(args.dataset, json.loads(args.annotations.read_text()), args.media_root,
                        args.split, json.loads(args.labels.read_text()) if args.labels else None, args.task)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text("".join(json.dumps(case) + "\n" for case in cases))
        return
    if not args.adapter or args.timeout <= 0 or not math.isfinite(args.timeout):
        parser.error("A nonempty adapter command and finite positive timeout are required")
    protocol = json.loads(args.protocol.read_text())
    for key in ("system", "revision", "models", "cacheMode", "subtitles", "hardware"):
        if key not in protocol:
            parser.error(f"Protocol is missing {key}")
    cases = [json.loads(line) for line in args.cases.read_text().splitlines() if line.strip()]
    ids = set(os.getenv("BENCHMARK_QUESTION_IDS", "").split(",")) - {""}
    if ids:
        cases = [case for case in cases if case["id"] in ids]
        if {case["id"] for case in cases} != ids:
            parser.error("A requested question ID was not found")
    if len({case["id"] for case in cases}) != len(cases):
        parser.error("Duplicate question identifiers")
    checked = {}
    for case in cases:
        media = case["media"]
        path = media["path"]
        if path not in checked:
            checked[path] = digest(Path(path))
        if checked[path] != media["sha256"]:
            parser.error("Source fingerprint changed; prepare the cases again")
    # Publish only after every selected case completes; infrastructure errors abort.
    rows = [run_case(case, args.adapter, args.timeout, protocol) for case in cases]
    report(rows, args.output, {**protocol, "casesSha256": digest(args.cases),
                             "questionIds": [case["id"] for case in cases]})


if __name__ == "__main__":
    main()
