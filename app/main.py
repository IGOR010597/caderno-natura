from __future__ import annotations

from datetime import datetime
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .database import add_history, get_history, initialize, list_history
from .models import SpreadsheetRequest
from .services import (
    aggregate_products,
    create_workbook,
    create_workbook_bytes,
    decode_share_token,
    encode_share_token,
    extract_rows_with_gemini,
    extract_text_from_image,
    normalize_image,
    parse_ocr_text,
)


BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
GENERATED_DIR = DATA_DIR / "generated"
DB_PATH = DATA_DIR / "natura.db"
MAX_IMAGE_SIZE = 15 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}

GENERATED_DIR.mkdir(parents=True, exist_ok=True)
initialize(DB_PATH)

app = FastAPI(title="Caderno para Natura", version="1.0.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.middleware("http")
async def allow_mobile_capabilities(request, call_next):
    response = await call_next(request)
    response.headers["Permissions-Policy"] = "web-share=(self), camera=(self)"
    return response


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.post("/api/ocr")
async def run_ocr(image: UploadFile = File(...)):
    if image.content_type not in ALLOWED_TYPES:
        raise HTTPException(415, "Envie uma imagem JPG, PNG, WEBP ou HEIC.")
    content = await image.read(MAX_IMAGE_SIZE + 1)
    if len(content) > MAX_IMAGE_SIZE:
        raise HTTPException(413, "A imagem deve ter no máximo 15 MB.")
    if not content:
        raise HTTPException(400, "A imagem está vazia.")
    try:
        normalized_content = normalize_image(content)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    try:
        rows = extract_rows_with_gemini(normalized_content, "image/jpeg")
        return {"rows": rows, "engine": "gemini", "warning": None}
    except RuntimeError as ai_error:
        ai_warning = str(ai_error)
    try:
        text = extract_text_from_image(normalized_content)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    return {
        "rows": parse_ocr_text(text),
        "raw_text": text,
        "engine": "tesseract",
        "warning": f"{ai_warning} Foi usada a leitura básica como alternativa.",
    }


@app.post("/api/spreadsheets", status_code=201)
def generate_spreadsheet(payload: SpreadsheetRequest):
    if not payload.review_confirmed:
        raise HTTPException(400, "Confirme a revisão dos dados antes de gerar a planilha.")
    try:
        products = aggregate_products([item.model_dump() for item in payload.products])
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    now = datetime.now()
    filename = f"pedido_natura_{now:%d-%m-%Y}.xlsx"
    stored_name = f"{now:%Y%m%d_%H%M%S}_{uuid4().hex[:8]}.xlsx"
    create_workbook(products, GENERATED_DIR / stored_name)
    item_id = add_history(
        DB_PATH, now.isoformat(timespec="seconds"), len(products), sum(products.values()),
        filename, stored_name,
    )
    return {
        "id": item_id,
        "filename": filename,
        "download_url": f"/api/spreadsheets/{item_id}/download",
        "share_url": f"/s/{encode_share_token(products)}",
        "product_count": len(products),
        "unit_count": sum(products.values()),
    }


@app.get("/s/{token}", include_in_schema=False)
def shared_spreadsheet(token: str):
    try:
        products = decode_share_token(token)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    filename = f"pedido_natura_{datetime.now():%d-%m-%Y}.xlsx"
    content = create_workbook_bytes(products)
    return StreamingResponse(
        BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/history")
def history():
    return list_history(DB_PATH)


@app.get("/api/spreadsheets/{item_id}/download")
def download_spreadsheet(item_id: int):
    item = get_history(DB_PATH, item_id)
    if not item:
        raise HTTPException(404, "Planilha não encontrada.")
    path = GENERATED_DIR / item["stored_name"]
    if not path.exists():
        raise HTTPException(404, "O arquivo desta planilha não está mais disponível.")
    return FileResponse(
        path,
        filename=item["filename"],
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
