from pydantic import BaseModel, Field


class ProductInput(BaseModel):
    code: str = Field(default="", max_length=40)
    quantity: int | None = None


class SpreadsheetRequest(BaseModel):
    products: list[ProductInput]
    review_confirmed: bool = False

