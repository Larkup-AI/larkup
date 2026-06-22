import os
import httpx
from typing import Optional, Union, Dict, Any
from .types import (
    Document,
    PaginatedDocuments,
    QueryRequest,
    QueryResponse,
    ScrapeResponse,
    HealthResponse,
    LarkupRAGClientOptions,
)

class LarkupRAGError(Exception):
    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code

class LarkupRAGClient:
    """Synchronous client for Larkup RAG API."""
    
    def __init__(self, options: Optional[LarkupRAGClientOptions] = None):
        options = options or LarkupRAGClientOptions()
        
        base_url = options.base_url or os.getenv("LARKUP_RAG_API_URL", "http://localhost:8080")
        self.base_url = base_url.rstrip("/")
        self.api_key = options.api_key or os.getenv("LARKUP_RAG_API_KEY")
        self._client = httpx.Client(base_url=self.base_url)

    def _get_headers(self) -> Dict[str, str]:
        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _handle_error(self, response: httpx.Response):
        if not response.is_success:
            error_msg = response.reason_phrase
            try:
                err_body = response.json()
                if isinstance(err_body, dict) and "error" in err_body:
                    error_msg = err_body["error"]
            except Exception:
                pass
            raise LarkupRAGError(f"LarkupRAG API Error ({response.status_code}): {error_msg}", response.status_code)

    def _request(self, method: str, path: str, **kwargs) -> Any:
        headers = self._get_headers()
        if "headers" in kwargs:
            headers.update(kwargs.pop("headers"))
            
        response = self._client.request(method, path, headers=headers, **kwargs)
        self._handle_error(response)
        return response.json()

    def health(self) -> HealthResponse:
        """Health check"""
        data = self._request("GET", "/health")
        return HealthResponse(**data)

    def query(self, request: Union[QueryRequest, str], top_k: Optional[int] = None) -> QueryResponse:
        """Query the RAG knowledge base"""
        if isinstance(request, str):
            request_data = QueryRequest(query=request, topK=top_k)
        else:
            request_data = request
            
        data = self._request("POST", "/query", json=request_data.model_dump(exclude_none=True))
        return QueryResponse(**data)

    def list_documents(self, page: int = 1, limit: int = 20) -> PaginatedDocuments:
        """List documents with pagination"""
        data = self._request("GET", "/documents", params={"page": page, "limit": limit})
        return PaginatedDocuments(**data)

    def get_document(self, id: str) -> Document:
        """Get a specific document by ID"""
        data = self._request("GET", f"/documents/{id}")
        return Document(**data)

    def add_document(self, document: Document) -> Dict[str, Any]:
        """Add a new document to the vector store"""
        # We allow 'id' in Document to be optionally ignored by the server, 
        # but to mirror JS we just send it as dict.
        payload = document.model_dump(exclude_none=True)
        if "id" in payload and not payload["id"]:
            del payload["id"]
            
        data = self._request("POST", "/documents", json=payload)
        return data

    def update_document(self, id: str, document: Document) -> Dict[str, Any]:
        """Update an existing document"""
        payload = document.model_dump(exclude_none=True)
        data = self._request("PUT", f"/documents/{id}", json=payload)
        return data

    def delete_document(self, id: str) -> Dict[str, Any]:
        """Delete a document"""
        data = self._request("DELETE", f"/documents/{id}")
        return data

    def scrape(self, url: str) -> ScrapeResponse:
        """Scrape a URL and add it to the corpus"""
        data = self._request("POST", "/scrape", json={"url": url})
        return ScrapeResponse(**data)

    def close(self):
        """Close the underlying HTTP client"""
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


class AsyncLarkupRAGClient:
    """Asynchronous client for Larkup RAG API."""
    
    def __init__(self, options: Optional[LarkupRAGClientOptions] = None):
        options = options or LarkupRAGClientOptions()
        
        base_url = options.base_url or os.getenv("LARKUP_RAG_API_URL", "http://localhost:8080")
        self.base_url = base_url.rstrip("/")
        self.api_key = options.api_key or os.getenv("LARKUP_RAG_API_KEY")
        self._client = httpx.AsyncClient(base_url=self.base_url)

    def _get_headers(self) -> Dict[str, str]:
        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _handle_error(self, response: httpx.Response):
        if not response.is_success:
            error_msg = response.reason_phrase
            try:
                err_body = response.json()
                if isinstance(err_body, dict) and "error" in err_body:
                    error_msg = err_body["error"]
            except Exception:
                pass
            raise LarkupRAGError(f"LarkupRAG API Error ({response.status_code}): {error_msg}", response.status_code)

    async def _request(self, method: str, path: str, **kwargs) -> Any:
        headers = self._get_headers()
        if "headers" in kwargs:
            headers.update(kwargs.pop("headers"))
            
        response = await self._client.request(method, path, headers=headers, **kwargs)
        self._handle_error(response)
        return response.json()

    async def health(self) -> HealthResponse:
        """Health check"""
        data = await self._request("GET", "/health")
        return HealthResponse(**data)

    async def query(self, request: Union[QueryRequest, str], top_k: Optional[int] = None) -> QueryResponse:
        """Query the RAG knowledge base"""
        if isinstance(request, str):
            request_data = QueryRequest(query=request, topK=top_k)
        else:
            request_data = request
            
        data = await self._request("POST", "/query", json=request_data.model_dump(exclude_none=True))
        return QueryResponse(**data)

    async def list_documents(self, page: int = 1, limit: int = 20) -> PaginatedDocuments:
        """List documents with pagination"""
        data = await self._request("GET", "/documents", params={"page": page, "limit": limit})
        return PaginatedDocuments(**data)

    async def get_document(self, id: str) -> Document:
        """Get a specific document by ID"""
        data = await self._request("GET", f"/documents/{id}")
        return Document(**data)

    async def add_document(self, document: Document) -> Dict[str, Any]:
        """Add a new document to the vector store"""
        payload = document.model_dump(exclude_none=True)
        if "id" in payload and not payload["id"]:
            del payload["id"]
            
        data = await self._request("POST", "/documents", json=payload)
        return data

    async def update_document(self, id: str, document: Document) -> Dict[str, Any]:
        """Update an existing document"""
        payload = document.model_dump(exclude_none=True)
        data = await self._request("PUT", f"/documents/{id}", json=payload)
        return data

    async def delete_document(self, id: str) -> Dict[str, Any]:
        """Delete a document"""
        data = await self._request("DELETE", f"/documents/{id}")
        return data

    async def scrape(self, url: str) -> ScrapeResponse:
        """Scrape a URL and add it to the corpus"""
        data = await self._request("POST", "/scrape", json={"url": url})
        return ScrapeResponse(**data)

    async def close(self):
        """Close the underlying HTTP client"""
        await self._client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
