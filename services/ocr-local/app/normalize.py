"""Funciones puras (sin dependencias pesadas) para normalizar la salida de los motores."""
from typing import Iterable, Sequence


def clamp01(v: float) -> float:
    return min(1.0, max(0.0, float(v)))


def box_from_xyxy(x0: float, y0: float, x1: float, y1: float, width: int, height: int) -> dict:
    """Caja en píxeles (esquinas) -> {x,y,w,h} normalizada 0..1 (origen arriba-izquierda)."""
    x0, x1 = sorted((x0, x1))
    y0, y1 = sorted((y0, y1))
    x = clamp01(x0 / width)
    y = clamp01(y0 / height)
    return {
        "x": x,
        "y": y,
        "w": min(clamp01((x1 - x0) / width), 1.0 - x),
        "h": min(clamp01((y1 - y0) / height), 1.0 - y),
    }


def box_from_polygon(poly: Iterable[Sequence[float]], width: int, height: int) -> dict:
    pts = list(poly)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return box_from_xyxy(min(xs), min(ys), max(xs), max(ys), width, height)


def item(text: str, confidence: float, box: dict) -> dict:
    return {"text": text, "confidence": clamp01(confidence), **box}
