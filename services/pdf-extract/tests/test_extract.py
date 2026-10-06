import fitz
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

LONG = "Texto de párrafo digital con suficiente contenido para superar el umbral. " * 3


def _png() -> bytes:
    pm = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 200, 200), False)
    pm.set_rect(pm.irect, (230, 230, 230))
    return pm.tobytes("png")


def _digital_page(doc: fitz.Document) -> None:
    page = doc.new_page()
    page.insert_text((72, 80), "Informe clinico", fontsize=24)
    y = 120
    for line in LONG.split(". ")[:2]:
        page.insert_text((72, y), line, fontsize=11)
        y += 18
    for item in ["- primer elemento de la lista", "- segundo elemento de la lista"]:
        page.insert_text((72, y), item, fontsize=11)
        y += 18
    # Tabla 3x3 con bordes
    x0, y0, cw, rh = 72, y + 20, 120, 24
    for r in range(3):
        for c in range(3):
            rect = fitz.Rect(x0 + c * cw, y0 + r * rh, x0 + (c + 1) * cw, y0 + (r + 1) * rh)
            page.draw_rect(rect)
            page.insert_text((rect.x0 + 4, rect.y1 - 7), f"celda{r}{c}", fontsize=10)


def _scanned_page(doc: fitz.Document) -> None:
    page = doc.new_page()
    page.insert_image(page.rect, stream=_png())


def _pdf(*kinds: str) -> bytes:
    doc = fitz.open()
    for k in kinds:
        (_digital_page if k == "d" else _scanned_page)(doc)
    data = doc.tobytes()
    doc.close()
    return data


def _extract(data: bytes):
    res = client.post("/extract", content=data, headers={"Content-Type": "application/pdf"})
    return res


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_digital_page_gives_markdown():
    res = _extract(_pdf("d"))
    assert res.status_code == 200
    p = res.json()["pages"][0]
    assert p["pageNumber"] == 1
    assert p["kind"] == "digital"
    assert p["chars"] >= 60
    assert p["width"] > 0 and p["height"] > 0
    md = p["markdown"]
    assert "#" in md
    assert "- " in md or "* " in md
    assert "|" in md


def test_image_only_page_is_scanned():
    p = _extract(_pdf("s")).json()["pages"][0]
    assert p["kind"] == "escaneada"
    assert p["markdown"] == ""


def test_mixed_pdf():
    pages = _extract(_pdf("d", "s", "d")).json()["pages"]
    assert [p["kind"] for p in pages] == ["digital", "escaneada", "digital"]
    assert [p["pageNumber"] for p in pages] == [1, 2, 3]


def test_min_chars_query_overrides_threshold():
    data = _pdf("d")
    res = client.post("/extract?min_chars=100000", content=data)
    assert res.json()["pages"][0]["kind"] == "escaneada"


def test_corrupt_pdf_is_400():
    assert _extract(b"esto no es un pdf").status_code == 400


def test_empty_body_is_400():
    assert _extract(b"").status_code == 400
