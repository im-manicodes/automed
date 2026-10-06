"""Clasificación por página (digital / escaneada) y conversión a markdown de las digitales.

No registra contenido de los documentos en logs.
"""
from __future__ import annotations

import re
from typing import Any

import fitz  # PyMuPDF
import pymupdf4llm

# Una imagen que cubre más de esta fracción de la página la hace «imagen a página completa».
IMAGE_COVERAGE_THRESHOLD = 0.85


class InvalidPdfError(ValueError):
    pass


def _chars(page: "fitz.Page") -> int:
    return len(re.sub(r"\s+", "", page.get_text("text")))


def _image_coverage(page: "fitz.Page") -> float:
    area = page.rect.width * page.rect.height
    if area <= 0:
        return 0.0
    covered = 0.0
    for img in page.get_images(full=True):
        try:
            rects = page.get_image_rects(img[0])
        except Exception:
            continue
        for r in rects:
            r = r & page.rect
            if not r.is_empty:
                covered = max(covered, r.width * r.height)
    return covered / area


def classify(chars: int, coverage: float, min_chars: int) -> str:
    """digital: capa de texto suficiente y no es un escaneo con texto residual."""
    if chars < min_chars:
        return "escaneada"
    # Imagen a página completa con poco texto encima (p. ej. sello/folio): sigue siendo escaneo.
    if coverage > IMAGE_COVERAGE_THRESHOLD and chars < min_chars * 4:
        return "escaneada"
    return "digital"


def _normalize(md: str) -> str:
    md = md.replace("\r\n", "\n").replace("\x00", "")
    md = re.sub(r"[ \t]+\n", "\n", md)
    md = re.sub(r"\n{3,}", "\n\n", md)
    return md.strip()


def extract_pdf(data: bytes, min_chars: int) -> list[dict[str, Any]]:
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as e:
        raise InvalidPdfError("PDF inválido") from e
    try:
        if doc.needs_pass:
            raise InvalidPdfError("PDF protegido con contraseña")
        pages: list[dict[str, Any]] = []
        for i in range(doc.page_count):
            page = doc[i]
            chars = _chars(page)
            kind = classify(chars, _image_coverage(page), min_chars)
            markdown = ""
            if kind == "digital":
                try:
                    markdown = _normalize(pymupdf4llm.to_markdown(doc, pages=[i]))
                except Exception:
                    markdown = ""
                if not markdown:
                    # Sin markdown utilizable: que lo resuelva el OCR.
                    kind = "escaneada"
            pages.append(
                {
                    "pageNumber": i + 1,
                    "kind": kind,
                    "markdown": markdown,
                    "width": page.rect.width,
                    "height": page.rect.height,
                    "chars": chars,
                }
            )
        return pages
    except InvalidPdfError:
        raise
    except Exception as e:
        raise InvalidPdfError("No se pudo leer el PDF") from e
    finally:
        doc.close()
