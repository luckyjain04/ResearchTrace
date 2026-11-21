"""FastAPI adapter for ResearchTrace's existing SciFact and PubMed engines.

The Streamlit app.py is intentionally not imported or modified.
"""
from __future__ import annotations

from collections import Counter
from functools import lru_cache
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from evidence_engine import EvidenceEngine
from pubmed_engine import search_pubmed


app = FastAPI(title="ResearchTrace API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@lru_cache(maxsize=1)
def get_engine() -> EvidenceEngine:
    return EvidenceEngine()


class AnalyzeRequest(BaseModel):
    claim: str = Field(min_length=3, max_length=2000)
    local_count: int = Field(default=10, ge=1, le=50)
    pubmed_count: int = Field(default=5, ge=1, le=20)
    include_pubmed: bool = True


class GraphRequest(BaseModel):
    claim: str = Field(min_length=3, max_length=2000)
    graph_type: str = Field(default="local", pattern="^(local|pubmed)$")
    paper_count: int = Field(default=12, ge=1, le=30)


TOPIC_GROUPS = {
    "Creatine and supplementation": ["creatine monohydrate", "creatine", "phosphocreatine", "supplementation"],
    "Muscle and exercise": ["muscle strength", "muscle mass", "resistance training", "strength training", "exercise performance", "muscle"],
    "Cognition and brain": ["cognitive function", "cognitive performance", "cognition", "brain", "memory", "neuroprotection"],
    "Kidney and renal function": ["glomerular filtration", "kidney function", "renal function", "kidney", "renal"],
    "Gut microbiome": ["gut microbiome", "gut microbiota", "intestinal microbiome", "intestinal microbiota", "gut bacteria", "microbial community"],
    "Digestion and absorption": ["nutrient absorption", "digestion", "digestive", "gastrointestinal"],
    "Immunity and inflammation": ["immune system", "immune response", "immunity", "inflammation", "inflammatory"],
    "Mood and mental health": ["gut-brain axis", "mental health", "depression", "anxiety", "mood"],
    "Vitamin C": ["vitamin c", "ascorbic acid", "ascorbate"],
    "Common cold and respiratory illness": ["common cold", "cold symptoms", "upper respiratory", "respiratory infection"],
    "Vitamin D": ["vitamin d", "cholecalciferol", "25-hydroxyvitamin d"],
    "Folate and homocysteine": ["folate", "folic acid", "homocysteine", "vitamin b9"],
    "Smoking and tobacco": ["smoking", "smoker", "tobacco", "cigarette"],
    "Lung cancer": ["lung cancer", "pulmonary carcinoma", "lung neoplasm"],
    "Prion disease": ["prion protein", "abnormal prp", "prpsc", "prion"],
    "Clinical trials and reviews": ["randomized controlled trial", "randomised controlled trial", "systematic review", "meta-analysis", "clinical trial"],
}


def detect_topics(text: str, limit: int = 3) -> list[str]:
    normalized = str(text or "").casefold()
    found = []
    for topic, phrases in TOPIC_GROUPS.items():
        if any(phrase in normalized for phrase in phrases):
            found.append(topic)
    return found[:limit]


def _dataset_verdict_counts(engine: EvidenceEngine) -> dict[str, int]:
    counts = {"Supports": 0, "Refutes": 0, "Mixed evidence": 0, "Insufficient evidence": 0}
    for record in engine.claims_by_text.values():
        labels = set()
        annotations = record.get("evidence") or {}
        if isinstance(annotations, dict):
            for paper_items in annotations.values():
                if not isinstance(paper_items, list):
                    continue
                for annotation in paper_items:
                    if isinstance(annotation, dict):
                        labels.add(engine.normalize_label(annotation.get("label")))
        has_support = "SUPPORT" in labels
        has_refute = "CONTRADICT" in labels
        if has_support and has_refute:
            counts["Mixed evidence"] += 1
        elif has_support:
            counts["Supports"] += 1
        elif has_refute:
            counts["Refutes"] += 1
        else:
            counts["Insufficient evidence"] += 1
    return counts


def _claim_text(record: dict[str, Any]) -> str:
    return str(record.get("claim") or record.get("text") or "").strip()


def _build_graph(claim: str, papers: list[dict], graph_type: str, evidence: list[dict] | None = None) -> dict:
    """Return graph nodes/edges matching the original Streamlit graph hierarchy."""
    nodes = [{
        "id": "research_claim",
        "label": claim[:48] + ("…" if len(claim) > 48 else ""),
        "kind": "claim",
        "details": claim,
    }]
    edges = []
    evidence_by_paper: dict[str, list[dict]] = {}
    for item in evidence or []:
        paper_id = str(item.get("paper_id") or item.get("doc_id") or "")
        if paper_id:
            evidence_by_paper.setdefault(paper_id, []).append(item)

    seen_topics = set()
    for index, paper in enumerate(papers):
        paper_id = str(paper.get("doc_id") or paper.get("pmid") or f"paper_{index}")
        paper_node_id = f"paper_{index}"
        title = str(paper.get("title") or "Untitled paper")
        abstract_value = paper.get("abstract") or ""
        abstract = " ".join(abstract_value) if isinstance(abstract_value, list) else str(abstract_value)
        nodes.append({
            "id": paper_node_id,
            "label": title[:33] + ("…" if len(title) > 33 else ""),
            "kind": "paper",
            "details": title,
            "paper_id": paper_id,
            "abstract": abstract,
            "url": paper.get("url") or (f"https://pubmed.ncbi.nlm.nih.gov/{paper_id}/" if graph_type == "pubmed" and paper_id.isdigit() else None),
        })
        edges.append({"source": "research_claim", "target": paper_node_id})

        if graph_type == "local":
            for evidence_index, item in enumerate(evidence_by_paper.get(paper_id, [])[:2]):
                evidence_node_id = f"evidence_{index}_{evidence_index}"
                sentence = str(item.get("sentence") or "")
                label = str(item.get("label") or "UNKNOWN")
                nodes.append({
                    "id": evidence_node_id,
                    "label": sentence[:30] + ("…" if len(sentence) > 30 else ""),
                    "kind": "evidence",
                    "details": f"{label}: {sentence}",
                    "paper_id": paper_id,
                    "evidence_label": label,
                    "sentence_index": item.get("sentence_index"),
                })
                edges.append({"source": paper_node_id, "target": evidence_node_id})
        else:
            topics = detect_topics(f"{title} {abstract}", limit=3) or ["Other research"]
            for topic in topics:
                topic_node_id = f"topic_{topic}"
                if topic_node_id not in seen_topics:
                    seen_topics.add(topic_node_id)
                    nodes.append({
                        "id": topic_node_id,
                        "label": topic,
                        "kind": "topic",
                        "details": f"Topic inferred from title and abstract keywords: {topic}",
                    })
                edges.append({"source": paper_node_id, "target": topic_node_id})

    return {"claim": claim, "graph_type": graph_type, "nodes": nodes, "edges": edges}


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "ResearchTrace API"}


@app.get("/api/dashboard")
def dashboard() -> dict[str, Any]:
    try:
        engine = get_engine()
        return {
            "total_papers": int(engine.search_engine.document_count),
            "annotated_claims": len(engine.claims_by_text),
            "evidence_types": 4,
            "verdict_distribution": _dataset_verdict_counts(engine),
            "statistics_note": "Counts describe the local SciFact dataset annotations; they are not live usage or accuracy metrics.",
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not load ResearchTrace dataset: {exc}") from exc


@app.post("/api/analyze")
def analyze(request: AnalyzeRequest) -> dict[str, Any]:
    claim = request.claim.strip()
    if not claim:
        raise HTTPException(status_code=422, detail="Enter a scientific claim.")
    try:
        local_result = get_engine().analyze(claim, top_k=request.local_count)
        pubmed_result = search_pubmed(claim, max_results=request.pubmed_count) if request.include_pubmed else None
        return {
            "claim": claim,
            "local": local_result,
            "pubmed": pubmed_result,
            "interpretation_note": (
                "A verdict is based on an exact annotated SciFact claim match. "
                "For claims without an exact match, retrieved-paper similarity and PubMed results "
                "are for literature exploration and do not establish truth."
            ),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Claim analysis failed: {exc}") from exc


@app.post("/api/graph")
def graph(request: GraphRequest) -> dict[str, Any]:
    claim = request.claim.strip()
    try:
        if request.graph_type == "local":
            result = get_engine().analyze(claim, top_k=request.paper_count)
            return _build_graph(claim, result.get("papers", [])[:request.paper_count], "local", result.get("evidence", []))
        result = search_pubmed(claim, max_results=request.paper_count)
        papers = (result.get("papers") or [])[:request.paper_count]
        graph_data = _build_graph(claim, papers, "pubmed")
        graph_data["pubmed_count"] = result.get("count", len(papers))
        graph_data["search_error"] = result.get("error")
        return graph_data
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not build knowledge graph: {exc}") from exc


@app.get("/api/evidence")
def evidence_library(
    q: str = Query(default="", max_length=500),
    label: str = Query(default="all"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    try:
        engine = get_engine()
        query = q.casefold().strip()
        wanted_label = label.casefold().strip()
        rows = []
        for record in engine.claims_by_text.values():
            claim = _claim_text(record)
            annotations = record.get("evidence") or {}
            if not isinstance(annotations, dict):
                continue
            items, _, _ = engine.extract_evidence(annotations)
            for item in items:
                row = {**item, "claim": claim, "source": "SciFact"}
                if wanted_label not in ("", "all") and str(row["label"]).casefold() != wanted_label:
                    continue
                searchable = " ".join([claim, row["title"], row["sentence"], row["paper_id"]]).casefold()
                if query and query not in searchable:
                    continue
                rows.append(row)
        rows.sort(key=lambda row: (row["claim"].casefold(), row["paper_id"], row["sentence_index"]))
        return {"total": len(rows), "limit": limit, "offset": offset, "items": rows[offset:offset + limit]}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not load evidence library: {exc}") from exc


@app.get("/api/analytics")
def analytics() -> dict[str, Any]:
    try:
        engine = get_engine()
        verdicts = _dataset_verdict_counts(engine)
        evidence_labels = Counter()
        paper_counts = Counter()
        total_evidence = 0
        for record in engine.claims_by_text.values():
            annotations = record.get("evidence") or {}
            if not isinstance(annotations, dict):
                continue
            for paper_id, annotation_items in annotations.items():
                if not isinstance(annotation_items, list):
                    continue
                for item in annotation_items:
                    if not isinstance(item, dict):
                        continue
                    label = engine.normalize_label(item.get("label"))
                    evidence_labels[label] += 1
                    paper_counts[str(paper_id)] += len(item.get("sentences") or [])
                    total_evidence += len(item.get("sentences") or [])
        top_papers = []
        for paper_id, count in paper_counts.most_common(10):
            paper = engine.papers_by_id.get(paper_id, {})
            top_papers.append({
                "paper_id": paper_id,
                "title": paper.get("title", "Untitled paper"),
                "evidence_sentence_count": count,
            })
        return {
            "total_papers": len(engine.papers_by_id),
            "annotated_claims": len(engine.claims_by_text),
            "verdict_distribution": verdicts,
            "annotation_label_counts": dict(evidence_labels),
            "total_annotated_sentence_references": total_evidence,
            "top_evidence_papers": top_papers,
            "note": "These are counts from SciFact training annotations and corpus records, not model performance, live usage, or causal scientific conclusions.",
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not calculate analytics: {exc}") from exc
