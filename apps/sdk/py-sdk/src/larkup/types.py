from typing import List, Optional
from pydantic import BaseModel, Field

class Document(BaseModel):
    id: str
    text: str
    title: Optional[str] = None
    url: Optional[str] = None
    documentId: Optional[str] = None

class QueryRequest(BaseModel):
    query: str
    topK: Optional[int] = None

class QueryHit(BaseModel):
    id: str
    score: float
    text: str
    title: str
    url: Optional[str] = None
    documentId: str

class QueryResponse(BaseModel):
    query: str
    hits: List[QueryHit]

class PaginatedDocuments(BaseModel):
    documents: List[Document]
    total: int
    page: int
    limit: int
    totalPages: int

class ScrapeRequest(BaseModel):
    url: str

class ScrapeResponse(BaseModel):
    success: bool
    documentId: Optional[str] = None
    error: Optional[str] = None

class HealthResponse(BaseModel):
    ok: bool
    service: Optional[str] = None

class LarkupClientOptions(BaseModel):
    base_url: Optional[str] = None
    api_key: Optional[str] = None
