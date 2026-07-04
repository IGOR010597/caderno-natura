from __future__ import annotations

import re
from collections import OrderedDict
from io import BytesIO
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font
from PIL import Image, ImageEnhance, ImageFilter, ImageOps


QUANTITY_MARKER = r"(?:[-–—:*=]|[xX]|qtd\.?|quantidade)?"
LINE_PATTERN = re.compile(
    rf"^\s*([A-Za-z0-9]+)\s*{QUANTITY_MARKER}\s*(\d+)?\s*$",
    re.IGNORECASE,
)


def parse_ocr_text(text: str) -> list[dict]:
    """Transform every non-empty OCR line into a reviewable row."""
    rows: list[dict] = []
    for raw in (line.strip() for line in text.splitlines()):
        if not raw:
            continue
        match = LINE_PATTERN.match(raw)
        if not match:
            rows.append({"code": "", "quantity": None, "status": "Revisar", "raw_line": raw})
            continue

        code, quantity_text = match.groups()
        quantity = int(quantity_text) if quantity_text else None
        valid = code.isdigit() and quantity is not None and quantity > 0
        rows.append(
            {
                "code": code,
                "quantity": quantity,
                "status": "OK" if valid else "Revisar",
                "raw_line": raw,
            }
        )
    return rows


def extract_text_from_image(content: bytes) -> str:
    try:
        import pytesseract
    except ImportError as exc:  # pragma: no cover - deployment guard
        raise RuntimeError("O mecanismo de OCR não está instalado no servidor.") from exc

    try:
        image = Image.open(BytesIO(content))
        image.verify()
        image = Image.open(BytesIO(content)).convert("L")
    except Exception as exc:
        raise ValueError("A imagem enviada não pôde ser lida.") from exc

    # Upscaling and contrast help Tesseract with photographed notebook pages.
    if image.width < 1800:
        ratio = 1800 / image.width
        image = image.resize((1800, int(image.height * ratio)))
    image = ImageOps.autocontrast(image)
    image = ImageEnhance.Contrast(image).enhance(1.6)
    image = image.filter(ImageFilter.SHARPEN)

    try:
        return pytesseract.image_to_string(image, lang="por", config="--psm 6")
    except pytesseract.TesseractNotFoundError as exc:
        raise RuntimeError(
            "Tesseract OCR não encontrado. Instale o Tesseract e reinicie o sistema."
        ) from exc
    except pytesseract.TesseractError:
        # Some installations do not include Portuguese; numbers work with English.
        try:
            return pytesseract.image_to_string(image, lang="eng", config="--psm 6")
        except Exception as exc:
            raise RuntimeError("Não foi possível processar a imagem com o OCR.") from exc


def aggregate_products(products: list[dict]) -> OrderedDict[str, int]:
    aggregated: OrderedDict[str, int] = OrderedDict()
    for item in products:
        code = str(item.get("code", "")).strip()
        quantity = item.get("quantity")
        if not code:
            raise ValueError("Há um produto com código vazio.")
        if not code.isdigit():
            raise ValueError(f"O código '{code}' deve conter apenas números.")
        if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity <= 0:
            raise ValueError(f"A quantidade do código {code} deve ser um inteiro maior que zero.")
        aggregated[code] = aggregated.get(code, 0) + quantity
    if not aggregated:
        raise ValueError("Adicione ao menos um produto antes de gerar a planilha.")
    return aggregated


def create_workbook(products: OrderedDict[str, int], destination: Path) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Sheet1"
    sheet.append(["CÓDIGO", "QT"])
    for code, quantity in products.items():
        sheet.append([code, quantity])
        sheet.cell(sheet.max_row, 1).number_format = "@"
    sheet["A1"].font = Font(bold=True)
    sheet["B1"].font = Font(bold=True)
    sheet.column_dimensions["A"].width = 18
    sheet.column_dimensions["B"].width = 10
    workbook.save(destination)

