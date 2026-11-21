"""
ResearchTrace: Retrieval Metrics Evaluation
------------------------------------------
Evaluates ResearchTrace's existing hybrid paper-retrieval system against
SciFact's annotated evidence-paper IDs.

Metrics reported at K = 5 and K = 10:
- Precision@K
- Recall@K
- F1@K
- Mean Reciprocal Rank (MRR@K)
- Mean Average Precision (MAP@K)
- Normalized Discounted Cumulative Gain (nDCG@K)
- Evidence-hit rate (percentage of claims with >=1 gold evidence paper retrieved)

Important:
This evaluates PAPER RETRIEVAL/RANKING, not scientific truth classification.
Accuracy is intentionally not reported: ResearchTrace's retrieval engine does
not output a binary true/false prediction for each claim, so claim-level
accuracy would be misleading. The verdict shown in the app for exact SciFact
claims comes from the dataset's own annotations, not an independent classifier.

Expected project structure:
ResearchTrace/
    eval_metrics.py
    research_engine.py
    data/
        claims_train.jsonl
        corpus.jsonl

Run from the project folder:
    python eval_metrics.py

The script writes per-claim results to eval_metrics_results.csv.
"""

import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

from research_engine import ResearchEngine


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
CLAIMS_FILE = DATA_DIR / "claims_train.jsonl"
CORPUS_FILE = DATA_DIR / "corpus.jsonl"
OUTPUT_FILE = BASE_DIR / "eval_metrics_results.csv"

K_VALUES = (5, 10)

# Set to an integer (for example, 100) to run a smaller quick evaluation.
# Keep as None to evaluate every eligible SciFact claim.
MAX_CLAIMS = None


def load_jsonl(path):
    """Load a JSONL file and show a helpful error if it is missing/invalid."""
    if not path.exists():
        raise FileNotFoundError(
            f"Required file not found: {path}\n"
            "Check that the 'data' folder contains the SciFact JSONL files."
        )

    rows = []
    with path.open("r", encoding="utf-8") as file:
        for line_number, line in enumerate(file, start=1):
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"Invalid JSON in {path.name}, line {line_number}: {exc}"
                ) from exc
    return rows


def get_gold_evidence_ids(claim_record, corpus_ids):
    """
    Return the annotated evidence paper IDs for a claim.

    A paper is considered relevant when SciFact's claim annotation contains
    at least one annotation item for that paper and the paper exists locally.
    """
    evidence = claim_record.get("evidence") or {}
    if not isinstance(evidence, dict):
        return set()

    relevant_ids = set()
    for raw_id, annotation_items in evidence.items():
        paper_id = str(raw_id)
        if paper_id not in corpus_ids:
            continue
        if isinstance(annotation_items, list) and any(
            isinstance(item, dict) for item in annotation_items
        ):
            relevant_ids.add(paper_id)

    return relevant_ids


def precision_at_k(retrieved_ids, relevant_ids, k):
    top = retrieved_ids[:k]
    if not top:
        return 0.0
    hits = len(set(top) & relevant_ids)
    return hits / len(top)


def recall_at_k(retrieved_ids, relevant_ids, k):
    if not relevant_ids:
        return float("nan")
    hits = len(set(retrieved_ids[:k]) & relevant_ids)
    return hits / len(relevant_ids)


def f1_from_precision_recall(precision, recall):
    if not np.isfinite(precision) or not np.isfinite(recall):
        return float("nan")
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


def reciprocal_rank_at_k(retrieved_ids, relevant_ids, k):
    for rank, paper_id in enumerate(retrieved_ids[:k], start=1):
        if paper_id in relevant_ids:
            return 1.0 / rank
    return 0.0


def average_precision_at_k(retrieved_ids, relevant_ids, k):
    """AP@K with denominator min(number of gold papers, K)."""
    if not relevant_ids:
        return float("nan")

    hits = 0
    precision_sum = 0.0
    for rank, paper_id in enumerate(retrieved_ids[:k], start=1):
        if paper_id in relevant_ids:
            hits += 1
            precision_sum += hits / rank

    denominator = min(len(relevant_ids), k)
    return precision_sum / denominator if denominator else 0.0


def ndcg_at_k(retrieved_ids, relevant_ids, k):
    """Binary-relevance nDCG@K."""
    if not relevant_ids:
        return float("nan")

    dcg = 0.0
    for rank, paper_id in enumerate(retrieved_ids[:k], start=1):
        relevance = 1.0 if paper_id in relevant_ids else 0.0
        dcg += relevance / math.log2(rank + 1)

    ideal_hits = min(len(relevant_ids), k)
    ideal_dcg = sum(
        1.0 / math.log2(rank + 1)
        for rank in range(1, ideal_hits + 1)
    )
    return dcg / ideal_dcg if ideal_dcg else 0.0


def mean_finite(values):
    """Average only defined values; return NaN if none are defined."""
    finite_values = [float(value) for value in values if np.isfinite(value)]
    return float(np.mean(finite_values)) if finite_values else float("nan")


def main():
    start_time = time.time()

    print("=" * 72)
    print("RESEARCHTRACE — RETRIEVAL METRICS EVALUATION")
    print("=" * 72)

    claims = load_jsonl(CLAIMS_FILE)
    corpus = load_jsonl(CORPUS_FILE)
    corpus_ids = {
        str(paper["doc_id"])
        for paper in corpus
        if paper.get("doc_id") is not None
    }

    eligible_claims = []
    for claim_record in claims:
        claim_text = str(claim_record.get("claim") or "").strip()
        gold_ids = get_gold_evidence_ids(claim_record, corpus_ids)
        # Claims without annotated evidence papers cannot be used to calculate
        # evidence-paper retrieval recall, so they are excluded from this run.
        if claim_text and gold_ids:
            eligible_claims.append((claim_record, gold_ids))

    if MAX_CLAIMS is not None:
        eligible_claims = eligible_claims[:MAX_CLAIMS]

    if not eligible_claims:
        raise RuntimeError(
            "No eligible claims with annotated evidence papers were found. "
            "Check the SciFact JSONL files and their schema."
        )

    print(f"Claims in dataset: {len(claims)}")
    print(f"Research papers in corpus: {len(corpus_ids)}")
    print(f"Claims evaluated (with gold evidence papers): {len(eligible_claims)}")
    print(f"Cut-offs K: {', '.join(map(str, K_VALUES))}")
    print("\nBuilding the existing ResearchTrace retrieval index...")

    engine = ResearchEngine()
    max_k = max(K_VALUES)
    per_claim_rows = []

    for index, (claim_record, gold_ids) in enumerate(eligible_claims, start=1):
        claim_text = str(claim_record.get("claim") or "").strip()
        claim_id = claim_record.get("id", index)

        results = engine.search(claim_text, top_k=max_k)
        retrieved_ids = []
        for result in results:
            raw_id = result.get("doc_id")
            if raw_id is not None:
                paper_id = str(raw_id)
                if paper_id not in retrieved_ids:
                    retrieved_ids.append(paper_id)

        row = {
            "claim_id": claim_id,
            "claim": claim_text,
            "gold_evidence_papers": len(gold_ids),
            "retrieved_papers": len(retrieved_ids),
        }

        for k in K_VALUES:
            p = precision_at_k(retrieved_ids, gold_ids, k)
            r = recall_at_k(retrieved_ids, gold_ids, k)
            row[f"Precision@{k}"] = p
            row[f"Recall@{k}"] = r
            row[f"F1@{k}"] = f1_from_precision_recall(p, r)
            row[f"MRR@{k}"] = reciprocal_rank_at_k(
                retrieved_ids, gold_ids, k
            )
            row[f"MAP@{k}"] = average_precision_at_k(
                retrieved_ids, gold_ids, k
            )
            row[f"nDCG@{k}"] = ndcg_at_k(retrieved_ids, gold_ids, k)
            row[f"EvidenceHit@{k}"] = int(
                bool(set(retrieved_ids[:k]) & gold_ids)
            )

        per_claim_rows.append(row)

        if index == 1 or index % 25 == 0 or index == len(eligible_claims):
            print(f"Processed {index}/{len(eligible_claims)} claims...")

    results_df = pd.DataFrame(per_claim_rows)
    results_df.to_csv(OUTPUT_FILE, index=False, encoding="utf-8-sig")

    print("\n" + "=" * 72)
    print("AGGREGATE RESULTS (macro-average across evaluated claims)")
    print("=" * 72)
    summary_rows = []

    for k in K_VALUES:
        summary = {
            "Metric": f"Precision@{k}",
            "Score": mean_finite(results_df[f"Precision@{k}"].tolist()),
        }
        summary_rows.append(summary)
        for metric in (
            f"Recall@{k}",
            f"F1@{k}",
            f"MRR@{k}",
            f"MAP@{k}",
            f"nDCG@{k}",
        ):
            summary_rows.append({
                "Metric": metric,
                "Score": mean_finite(results_df[metric].tolist()),
            })

        summary_rows.append({
            "Metric": f"EvidenceHitRate@{k}",
            "Score": float(results_df[f"EvidenceHit@{k}"].mean()),
        })

    summary_df = pd.DataFrame(summary_rows)
    print(summary_df.to_string(
        index=False,
        formatters={"Score": lambda value: f"{value:.4f}"}
    ))

    print("\nInterpretation:")
    print("- Precision@K: fraction of top-K retrieved papers that are annotated evidence.")
    print("- Recall@K: fraction of all annotated evidence papers found in the top K.")
    print("- F1@K: harmonic mean of Precision@K and Recall@K.")
    print("- MRR@K: rewards placing the first relevant paper near the top.")
    print("- MAP@K: measures how well relevant papers are ranked throughout the top K.")
    print("- nDCG@K: evaluates ranking order, giving more credit to relevant papers near the top.")
    print("- EvidenceHitRate@K: fraction of claims for which at least one gold paper appears in top K.")
    print("\nAccuracy is not reported because this system ranks papers rather than")
    print("predicting a binary label for every claim. Reporting accuracy here would")
    print("require an additional, clearly defined classification task.")
    print("\nEvaluation caveat: this uses SciFact's annotated evidence papers as")
    print("ground truth. It evaluates retrieval against those annotations; it does")
    print("not prove scientific truth, and it is not a held-out external test.")
    print(f"\nPer-claim results saved to:\n{OUTPUT_FILE}")
    print(f"Elapsed time: {time.time() - start_time:.1f} seconds")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"\nERROR: {error}", file=sys.stderr)
        print(
            "\nCheck that eval_metrics.py is in the ResearchTrace project root, "
            "research_engine.py is alongside it, and data/ contains "
            "claims_train.jsonl and corpus.jsonl.",
            file=sys.stderr,
        )
        raise
