"""
backend/rag/ingest.py — PDF parsing for the RAG pipeline.

Extracts text from uploaded PDFs (storybooks, exported stories).
"""

from __future__ import annotations

import fitz  # PyMuPDF


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Extract all text from a PDF file (bytes). Returns plain text."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages = []
    for page in doc:
        text = page.get_text("text")
        if text.strip():
            pages.append(text.strip())
    doc.close()
    return "\n\n".join(pages)
