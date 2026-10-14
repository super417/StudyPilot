"""Local BM25 retrieval. No embeddings and no extra dependencies.

Chinese text is split into character bigrams so a query can match part of a
chunk instead of the whole sentence. English and digits are whitespace and
punctuation tokens, lowercased.
"""

from __future__ import annotations

import math
from collections import Counter
from collections.abc import Sequence

# BM25 parameters. k1 saturates term frequency; b scales scores by chunk length.
K1 = 1.5
B = 0.75


def rank(
    query: str,
    chunks: Sequence[dict],
    k: int = 5,
) -> list[tuple[dict, float]]:
    """按 BM25 相关性返回 [(chunk, score)]，score 降序，最多 k 条。

    无命中（query 无有效词项，或所有 chunk 分数为 0）时返回 []。
    """
    if k <= 0:
        return []
    query_terms = _unique(tokenize(query))
    if not query_terms:
        return []

    prepared: list[tuple[dict, Counter[str], int]] = []
    for chunk in chunks:
        counts = Counter(tokenize(str(chunk.get("content") or "")))
        prepared.append((chunk, counts, sum(counts.values())))
    if not prepared:
        return []

    total_length = sum(length for _, _, length in prepared)
    average_length = total_length / len(prepared)
    if average_length <= 0:
        return []

    document_count = len(prepared)
    document_frequency = {
        term: sum(1 for _, counts, _ in prepared if counts.get(term, 0) > 0)
        for term in query_terms
    }

    scored: list[tuple[dict, float]] = []
    for chunk, counts, length in prepared:
        score = 0.0
        for term in query_terms:
            frequency = counts.get(term, 0)
            if frequency <= 0:
                continue
            containing = document_frequency[term]
            # Smoothed IDF: a term that occurs in every chunk stays finite.
            idf = math.log(1.0 + (document_count - containing + 0.5) / (containing + 0.5))
            denominator = frequency + K1 * (1.0 - B + B * length / average_length)
            score += idf * (frequency * (K1 + 1.0)) / denominator
        if score > 0:
            scored.append((chunk, score))

    scored.sort(
        key=lambda item: (
            -item[1],
            str(item[0].get("doc_id") or ""),
            int(item[0].get("chunk_index") or 0),
        )
    )
    return scored[:k]


def tokenize(text: str) -> list[str]:
    """Return bigrams for CJK runs and lowercased words for Latin and digits."""
    tokens: list[str] = []
    cjk: list[str] = []
    word: list[str] = []

    def flush_cjk() -> None:
        if len(cjk) >= 2:
            tokens.extend(cjk[index] + cjk[index + 1] for index in range(len(cjk) - 1))
        cjk.clear()

    def flush_word() -> None:
        if word:
            tokens.append("".join(word).lower())
            word.clear()

    for char in text or "":
        if _is_cjk(char):
            flush_word()
            cjk.append(char)
            continue
        if char.isalnum():
            flush_cjk()
            word.append(char)
            continue
        flush_cjk()
        flush_word()
    flush_cjk()
    flush_word()
    return tokens


def _unique(terms: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for term in terms:
        if term in seen:
            continue
        seen.add(term)
        ordered.append(term)
    return ordered


def _is_cjk(char: str) -> bool:
    code = ord(char)
    return (
        0x3400 <= code <= 0x4DBF
        or 0x4E00 <= code <= 0x9FFF
        or 0x3040 <= code <= 0x30FF
        or 0xAC00 <= code <= 0xD7AF
        or 0xF900 <= code <= 0xFAFF
    )
