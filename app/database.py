import sqlite3
from pathlib import Path


def initialize(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS spreadsheets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                product_count INTEGER NOT NULL,
                unit_count INTEGER NOT NULL,
                filename TEXT NOT NULL,
                stored_name TEXT NOT NULL
            )
            """
        )


def add_history(db_path: Path, created_at: str, product_count: int, unit_count: int,
                filename: str, stored_name: str) -> int:
    with sqlite3.connect(db_path) as connection:
        cursor = connection.execute(
            "INSERT INTO spreadsheets (created_at, product_count, unit_count, filename, stored_name) "
            "VALUES (?, ?, ?, ?, ?)",
            (created_at, product_count, unit_count, filename, stored_name),
        )
        return int(cursor.lastrowid)


def list_history(db_path: Path) -> list[dict]:
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            "SELECT id, created_at, product_count, unit_count, filename "
            "FROM spreadsheets ORDER BY id DESC LIMIT 20"
        ).fetchall()
    return [dict(row) for row in rows]


def get_history(db_path: Path, item_id: int) -> dict | None:
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            "SELECT * FROM spreadsheets WHERE id = ?", (item_id,)
        ).fetchone()
    return dict(row) if row else None

