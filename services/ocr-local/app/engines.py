"""Motores OCR locales. PaddleOCR (principal, CPU) y Tesseract (fallback / validación)."""
import io
import logging
import os
from typing import Optional

import numpy as np
from PIL import Image

from .normalize import box_from_polygon, box_from_xyxy, item

LANG = os.getenv("OCR_LANG", "es")  # idioma PaddleOCR (es/en/latin...)
TESS_LANG = os.getenv("TESSERACT_LANG", "spa")


def load_image(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data)).convert("RGB")


class TesseractEngine:
    name = "tesseract"

    def recognize(self, img: Image.Image) -> dict:
        import pytesseract

        w, h = img.size
        d = pytesseract.image_to_data(img, lang=TESS_LANG, output_type=pytesseract.Output.DICT)
        words, lines = [], {}
        for i, text in enumerate(d["text"]):
            conf = float(d["conf"][i])
            if not text.strip() or conf < 0:
                continue
            box = box_from_xyxy(
                d["left"][i], d["top"][i], d["left"][i] + d["width"][i], d["top"][i] + d["height"][i], w, h
            )
            words.append(item(text, conf / 100.0, box))
            key = (d["block_num"][i], d["par_num"][i], d["line_num"][i])
            lines.setdefault(key, []).append((text, conf / 100.0, d["left"][i], d["top"][i],
                                              d["left"][i] + d["width"][i], d["top"][i] + d["height"][i]))
        out_lines = []
        for ws in lines.values():
            txt = " ".join(t for t, *_ in ws)
            conf = sum(c for _, c, *_ in ws) / len(ws)
            box = box_from_xyxy(min(x[2] for x in ws), min(x[3] for x in ws),
                                max(x[4] for x in ws), max(x[5] for x in ws), w, h)
            out_lines.append(item(txt, conf, box))
        return {"width": w, "height": h, "words": words, "lines": out_lines}


class PaddleEngine:
    name = "paddle"

    def __init__(self) -> None:
        from paddleocr import PaddleOCR  # import tardío: es pesado

        # PaddleOCR 3.x. Sin orientación/desdistorsión de documento para ir más rápido en CPU.
        self._ocr = PaddleOCR(
            lang=LANG,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )

    def recognize(self, img: Image.Image) -> dict:
        w, h = img.size
        res = self._ocr.predict(np.array(img))
        lines = []
        for page in res:
            texts = page["rec_texts"]
            scores = page["rec_scores"]
            polys = page["rec_polys"]
            for t, s, poly in zip(texts, scores, polys):
                if t.strip():
                    lines.append(item(t, float(s), box_from_polygon(poly, w, h)))
        # PaddleOCR entrega líneas; no hay palabras.
        return {"width": w, "height": h, "words": [], "lines": lines}


_engine: Optional[object] = None
fallback_reason: Optional[str] = None


def get_engine():
    """OCR_LOCAL_ENGINE=paddle|tesseract. Con OCR_FALLBACK=true, si Paddle falla se usa Tesseract."""
    global _engine
    if _engine is not None:
        return _engine
    choice = os.getenv("OCR_LOCAL_ENGINE", "paddle").lower()
    if choice == "tesseract":
        _engine = TesseractEngine()
    else:
        try:
            _engine = PaddleEngine()
        except Exception as e:
            if os.getenv("OCR_FALLBACK", "true").lower() != "true":
                raise
            # Nunca degradar en silencio: queda en logs y en /health (fallback_reason).
            logging.getLogger("uvicorn.error").error("PaddleOCR no cargó, se usa Tesseract: %r", e)
            global fallback_reason
            fallback_reason = repr(e)[:300]
            _engine = TesseractEngine()
    return _engine
