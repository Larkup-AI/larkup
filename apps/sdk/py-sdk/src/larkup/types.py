from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class Document(BaseModel):
    id: Optional[str] = None
    text: str
    title: Optional[str] = None
    url: Optional[str] = None
    documentId: Optional[str] = None


class MutationResponse(BaseModel):
    success: bool


class AddDocumentResponse(MutationResponse):
    id: str


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
    metadata: Optional[Dict[str, Any]] = None


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
    chunks: Optional[int] = None
    error: Optional[str] = None


class HealthResponse(BaseModel):
    ok: bool
    service: Optional[str] = None


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    topK: Optional[int] = None


class ChatEvent(BaseModel):
    type: Literal["text-delta", "done", "error"]
    text: Optional[str] = None
    hits: Optional[List[QueryHit]] = None
    error: Optional[str] = None


class CorpusSummary(BaseModel):
    totalDocuments: int
    bySource: Dict[str, int]
    byStatus: Dict[str, int]
    totalCharacters: int


class CorpusFilter(BaseModel):
    source: Optional[str] = None
    titleContains: Optional[str] = None


class CorpusRequest(BaseModel):
    filter: Optional[CorpusFilter] = None
    limit: Optional[int] = None
    offset: Optional[int] = None
    includeContent: Optional[bool] = None


class CorpusDocument(BaseModel):
    id: str
    title: Optional[str] = None
    url: Optional[str] = None
    documentId: Optional[str] = None
    charCount: int
    content: Optional[str] = None


class CorpusResponse(BaseModel):
    documents: List[CorpusDocument]
    total: int
    page: int
    limit: int


class IndexProgressEvent(BaseModel):
    type: Literal["progress", "complete"]
    completed: int
    total: int
    succeeded: int
    failed: int
    percent: int
    document: Optional[Document] = None
    id: Optional[str] = None
    error: Optional[str] = None


class ToolConfigOption(BaseModel):
    label: str
    value: str


class ToolConfigField(BaseModel):
    key: str
    label: str
    type: Literal["text", "password", "select", "toggle"]
    defaultValue: Optional[str] = None
    help: Optional[str] = None
    required: Optional[bool] = None
    options: Optional[List[ToolConfigOption]] = None


class MarketplaceTool(BaseModel):
    id: str
    name: str
    description: str
    longDescription: Optional[str] = None
    category: Literal[
        "media",
        "search",
        "analytics",
        "integration",
        "embedding",
        "ai",
        "automation",
        "utility",
    ]
    version: str
    pricing: Literal["free", "pro", "enterprise"]
    emoji: Optional[str] = None
    iconUrl: Optional[str] = None
    icon: str
    packageName: str
    installSize: str
    systemDeps: Optional[List[str]] = None
    author: str
    capabilities: List[str]
    configSchema: Optional[List[ToolConfigField]] = None
    tags: Optional[List[str]] = None
    downloads: int
    repositoryUrl: Optional[str] = None
    license: Optional[str] = None
    changelog: Optional[str] = None
    minLarkupVersion: Optional[str] = None
    updatedAt: Optional[str] = None
    comingSoon: Optional[bool] = None


class ToolListResponse(BaseModel):
    tools: List[MarketplaceTool]
    total: int


class ToolVersion(BaseModel):
    version: str
    publishedAt: str


class ToolDetailResponse(BaseModel):
    tool: MarketplaceTool
    installs: int
    versions: List[ToolVersion]


class LarkupClientOptions(BaseModel):
    base_url: Optional[str] = None
    api_key: Optional[str] = None


class LarkupHubClientOptions(BaseModel):
    base_url: Optional[str] = None
    api_key: Optional[str] = None
