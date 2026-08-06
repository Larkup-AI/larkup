import asyncio
import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, AsyncIterator, Dict, Iterator, Literal, Optional, Sequence, Union
from urllib.parse import quote

import httpx

from .types import (
    ChatEvent,
    ChatRequest,
    CorpusRequest,
    CorpusResponse,
    CorpusSummary,
    Document,
    HealthResponse,
    IndexProgressEvent,
    LarkupClientOptions,
    MediaAsset,
    MediaJobStatus,
    MediaListResponse,
    PaginatedDocuments,
    QueryRequest,
    QueryResponse,
    ScrapeResponse,
    RefinementDecisionResponse,
)


class LarkupError(Exception):
    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


def _handle_error(response: httpx.Response) -> None:
    if response.is_success:
        return
    message = response.reason_phrase
    try:
        body = response.json()
        if isinstance(body, dict):
            message = body.get("error") or message
    except Exception:
        pass
    raise LarkupError(
        f"Larkup API Error ({response.status_code}): {message}",
        response.status_code,
    )


def _progress(
    *,
    completed: int,
    total: int,
    succeeded: int,
    failed: int,
    document: Optional[Document] = None,
    result: Optional[Dict[str, Any]] = None,
    error: Optional[str] = None,
) -> IndexProgressEvent:
    return IndexProgressEvent(
        type="progress",
        completed=completed,
        total=total,
        succeeded=succeeded,
        failed=failed,
        percent=100 if total == 0 else round(completed / total * 100),
        document=document,
        id=result.get("id") if result else None,
        error=error,
    )


class LarkupClient:
    """Synchronous client for a deployed Larkup RAG server."""

    def __init__(self, options: Optional[LarkupClientOptions] = None):
        options = options or LarkupClientOptions()
        base_url = options.base_url or os.getenv("LARKUP_API_URL", "http://localhost:8080")
        self.base_url = base_url.rstrip("/")
        self.api_key = options.api_key or os.getenv("LARKUP_API_KEY")
        self._client = httpx.Client(base_url=self.base_url)

    def _headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}

    def _response(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        headers = self._headers()
        headers.update(kwargs.pop("headers", {}))
        response = self._client.request(method, path, headers=headers, **kwargs)
        _handle_error(response)
        return response

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        return self._response(method, path, **kwargs).json()

    def health(self) -> HealthResponse:
        """Return server health and service name."""
        return HealthResponse(**self._request("GET", "/health"))

    def open_api(self) -> Dict[str, Any]:
        """Return the generated OpenAPI schema."""
        return self._request("GET", "/openapi.json")

    def query(
        self,
        request: Union[QueryRequest, str],
        top_k: Optional[int] = None,
    ) -> QueryResponse:
        """Run semantic retrieval against the configured index."""
        payload = (
            QueryRequest(query=request, topK=top_k)
            if isinstance(request, str)
            else request
        )
        data = self._request(
            "POST",
            "/query",
            json=payload.model_dump(exclude_none=True),
        )
        return QueryResponse(**data)

    def list_documents(self, page: int = 1, limit: int = 20) -> PaginatedDocuments:
        """List indexed document chunks with pagination."""
        data = self._request("GET", "/documents", params={"page": page, "limit": limit})
        return PaginatedDocuments(**data)

    def get_document(self, id: str) -> Document:
        """Return one indexed document chunk."""
        return Document(**self._request("GET", f"/documents/{quote(id, safe='')}"))

    def add_document(self, document: Document) -> Dict[str, Any]:
        """Embed and store one document."""
        data = self._request(
            "POST",
            "/documents",
            json=document.model_dump(exclude_none=True),
        )
        return data

    def update_document(self, id: str, document: Document) -> Dict[str, Any]:
        """Re-embed and replace one document."""
        data = self._request(
            "PUT",
            f"/documents/{quote(id, safe='')}",
            json=document.model_dump(exclude_none=True, exclude={"id"}),
        )
        return data

    def delete_document(self, id: str) -> Dict[str, Any]:
        """Remove one document from the index."""
        return self._request("DELETE", f"/documents/{quote(id, safe='')}")

    def scrape(self, url: str) -> ScrapeResponse:
        """Scrape a URL and index its text chunks."""
        return ScrapeResponse(**self._request("POST", "/scrape", json={"url": url}))

    def list_media(self) -> MediaListResponse:
        return MediaListResponse(**self._request("GET", "/media"))

    def get_media(self, id: str) -> MediaAsset:
        return MediaAsset(**self._request("GET", f"/media/{quote(id, safe='')}"))

    def delete_media(self, id: str) -> Dict[str, Any]:
        return self._request("DELETE", f"/media/{quote(id, safe='')}")

    def get_media_job_status(self, job_id: str) -> MediaJobStatus:
        return MediaJobStatus(**self._request("GET", f"/media/jobs/{quote(job_id, safe='')}"))

    def approve_refinement(self, job_id: str) -> RefinementDecisionResponse:
        return RefinementDecisionResponse(**self._request("POST", f"/media/jobs/{quote(job_id, safe='')}/approval", json={"decision": "approve"}))

    def decline_refinement(self, job_id: str) -> RefinementDecisionResponse:
        return RefinementDecisionResponse(**self._request("POST", f"/media/jobs/{quote(job_id, safe='')}/approval", json={"decision": "decline"}))

    def corpus_summary(self) -> CorpusSummary:
        """Return aggregate corpus statistics."""
        return CorpusSummary(**self._request("GET", "/corpus/summary"))

    def corpus(self, request: Optional[CorpusRequest] = None) -> CorpusResponse:
        """Return a filtered window of the indexed corpus."""
        payload = (request or CorpusRequest()).model_dump(exclude_none=True)
        return CorpusResponse(**self._request("POST", "/corpus", json=payload))

    def export_corpus(self, format: Literal["csv", "jsonl"] = "csv") -> str:
        """Export the indexed corpus as CSV or JSONL text."""
        return self._response(
            "POST",
            "/corpus/export",
            json={"format": format},
        ).text

    def index_documents(
        self,
        documents: Sequence[Document],
        *,
        mode: Literal["sequential", "parallel"] = "sequential",
        concurrency: int = 4,
        continue_on_error: bool = False,
    ) -> Iterator[IndexProgressEvent]:
        """Stream progress while documents are embedded and stored."""
        total = len(documents)
        completed = succeeded = failed = 0

        if mode not in ("sequential", "parallel"):
            raise ValueError("mode must be 'sequential' or 'parallel'")

        workers = 1 if mode == "sequential" else max(1, min(concurrency, max(total, 1)))
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(self.add_document, document): document
                for document in documents
            }
            for future in as_completed(futures):
                document = futures[future]
                completed += 1
                result = None
                error = None
                try:
                    result = future.result()
                    succeeded += 1
                except Exception as exc:
                    failed += 1
                    error = str(exc)

                yield _progress(
                    completed=completed,
                    total=total,
                    succeeded=succeeded,
                    failed=failed,
                    document=document,
                    result=result,
                    error=error,
                )

                if error and not continue_on_error:
                    raise LarkupError(error)

        yield IndexProgressEvent(
            type="complete",
            completed=completed,
            total=total,
            succeeded=succeeded,
            failed=failed,
            percent=100,
        )

    def chat(self, request: Union[ChatRequest, str]) -> Iterator[ChatEvent]:
        """Stream a retrieval-grounded chat response."""
        payload = (
            {"messages": [{"role": "user", "content": request}]}
            if isinstance(request, str)
            else request.model_dump(exclude_none=True)
        )
        with self._client.stream(
            "POST",
            "/chat",
            headers=self._headers(),
            json=payload,
        ) as response:
            if not response.is_success:
                response.read()
            _handle_error(response)
            for line in response.iter_lines():
                if line.startswith("data:"):
                    data = line[5:].strip()
                    if data:
                        yield ChatEvent(**json.loads(data))

    def chat_text(self, request: Union[ChatRequest, str]) -> str:
        """Collect a streamed chat response into one string."""
        output = ""
        for event in self.chat(request):
            if event.type == "error":
                raise LarkupError(event.error or "Chat request failed")
            output += event.text or ""
        return output

    def close(self) -> None:
        """Close the underlying HTTP client."""
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


class AsyncLarkupClient:
    """Asynchronous client for a deployed Larkup RAG server."""

    def __init__(self, options: Optional[LarkupClientOptions] = None):
        options = options or LarkupClientOptions()
        base_url = options.base_url or os.getenv("LARKUP_API_URL", "http://localhost:8080")
        self.base_url = base_url.rstrip("/")
        self.api_key = options.api_key or os.getenv("LARKUP_API_KEY")
        self._client = httpx.AsyncClient(base_url=self.base_url)

    def _headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}

    async def _response(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        headers = self._headers()
        headers.update(kwargs.pop("headers", {}))
        response = await self._client.request(method, path, headers=headers, **kwargs)
        _handle_error(response)
        return response

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        return (await self._response(method, path, **kwargs)).json()

    async def health(self) -> HealthResponse:
        """Return server health and service name."""
        return HealthResponse(**await self._request("GET", "/health"))

    async def open_api(self) -> Dict[str, Any]:
        """Return the generated OpenAPI schema."""
        return await self._request("GET", "/openapi.json")

    async def query(
        self,
        request: Union[QueryRequest, str],
        top_k: Optional[int] = None,
    ) -> QueryResponse:
        """Run semantic retrieval against the configured index."""
        payload = (
            QueryRequest(query=request, topK=top_k)
            if isinstance(request, str)
            else request
        )
        data = await self._request(
            "POST",
            "/query",
            json=payload.model_dump(exclude_none=True),
        )
        return QueryResponse(**data)

    async def list_documents(self, page: int = 1, limit: int = 20) -> PaginatedDocuments:
        """List indexed document chunks with pagination."""
        data = await self._request(
            "GET",
            "/documents",
            params={"page": page, "limit": limit},
        )
        return PaginatedDocuments(**data)

    async def get_document(self, id: str) -> Document:
        """Return one indexed document chunk."""
        return Document(
            **await self._request("GET", f"/documents/{quote(id, safe='')}")
        )

    async def add_document(self, document: Document) -> Dict[str, Any]:
        """Embed and store one document."""
        data = await self._request(
            "POST",
            "/documents",
            json=document.model_dump(exclude_none=True),
        )
        return data

    async def update_document(self, id: str, document: Document) -> Dict[str, Any]:
        """Re-embed and replace one document."""
        data = await self._request(
            "PUT",
            f"/documents/{quote(id, safe='')}",
            json=document.model_dump(exclude_none=True, exclude={"id"}),
        )
        return data

    async def delete_document(self, id: str) -> Dict[str, Any]:
        """Remove one document from the index."""
        data = await self._request("DELETE", f"/documents/{quote(id, safe='')}")
        return data

    async def scrape(self, url: str) -> ScrapeResponse:
        """Scrape a URL and index its text chunks."""
        return ScrapeResponse(
            **await self._request("POST", "/scrape", json={"url": url})
        )

    async def list_media(self) -> MediaListResponse:
        return MediaListResponse(**await self._request("GET", "/media"))

    async def get_media(self, id: str) -> MediaAsset:
        return MediaAsset(**await self._request("GET", f"/media/{quote(id, safe='')}"))

    async def delete_media(self, id: str) -> Dict[str, Any]:
        return await self._request("DELETE", f"/media/{quote(id, safe='')}")

    async def get_media_job_status(self, job_id: str) -> MediaJobStatus:
        return MediaJobStatus(**await self._request("GET", f"/media/jobs/{quote(job_id, safe='')}"))

    async def approve_refinement(self, job_id: str) -> RefinementDecisionResponse:
        return RefinementDecisionResponse(**await self._request("POST", f"/media/jobs/{quote(job_id, safe='')}/approval", json={"decision": "approve"}))

    async def decline_refinement(self, job_id: str) -> RefinementDecisionResponse:
        return RefinementDecisionResponse(**await self._request("POST", f"/media/jobs/{quote(job_id, safe='')}/approval", json={"decision": "decline"}))

    async def corpus_summary(self) -> CorpusSummary:
        """Return aggregate corpus statistics."""
        return CorpusSummary(**await self._request("GET", "/corpus/summary"))

    async def corpus(self, request: Optional[CorpusRequest] = None) -> CorpusResponse:
        """Return a filtered window of the indexed corpus."""
        payload = (request or CorpusRequest()).model_dump(exclude_none=True)
        return CorpusResponse(**await self._request("POST", "/corpus", json=payload))

    async def export_corpus(self, format: Literal["csv", "jsonl"] = "csv") -> str:
        """Export the indexed corpus as CSV or JSONL text."""
        response = await self._response(
            "POST",
            "/corpus/export",
            json={"format": format},
        )
        return response.text

    async def index_documents(
        self,
        documents: Sequence[Document],
        *,
        mode: Literal["sequential", "parallel"] = "sequential",
        concurrency: int = 4,
        continue_on_error: bool = False,
    ) -> AsyncIterator[IndexProgressEvent]:
        """Stream progress while documents are embedded and stored."""
        if mode not in ("sequential", "parallel"):
            raise ValueError("mode must be 'sequential' or 'parallel'")

        total = len(documents)
        limit = 1 if mode == "sequential" else max(1, min(concurrency, max(total, 1)))
        pending: Dict[asyncio.Task[Dict[str, Any]], Document] = {}
        cursor = completed = succeeded = failed = 0

        while cursor < total or pending:
            while cursor < total and len(pending) < limit:
                document = documents[cursor]
                pending[asyncio.create_task(self.add_document(document))] = document
                cursor += 1

            done, _ = await asyncio.wait(
                pending,
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in done:
                document = pending.pop(task)
                completed += 1
                result = None
                error = None
                try:
                    result = task.result()
                    succeeded += 1
                except Exception as exc:
                    failed += 1
                    error = str(exc)

                yield _progress(
                    completed=completed,
                    total=total,
                    succeeded=succeeded,
                    failed=failed,
                    document=document,
                    result=result,
                    error=error,
                )

                if error and not continue_on_error:
                    for queued in pending:
                        queued.cancel()
                    raise LarkupError(error)

        yield IndexProgressEvent(
            type="complete",
            completed=completed,
            total=total,
            succeeded=succeeded,
            failed=failed,
            percent=100,
        )

    async def chat(self, request: Union[ChatRequest, str]) -> AsyncIterator[ChatEvent]:
        """Stream a retrieval-grounded chat response."""
        payload = (
            {"messages": [{"role": "user", "content": request}]}
            if isinstance(request, str)
            else request.model_dump(exclude_none=True)
        )
        async with self._client.stream(
            "POST",
            "/chat",
            headers=self._headers(),
            json=payload,
        ) as response:
            if not response.is_success:
                await response.aread()
            _handle_error(response)
            async for line in response.aiter_lines():
                if line.startswith("data:"):
                    data = line[5:].strip()
                    if data:
                        yield ChatEvent(**json.loads(data))

    async def chat_text(self, request: Union[ChatRequest, str]) -> str:
        """Collect a streamed chat response into one string."""
        output = ""
        async for event in self.chat(request):
            if event.type == "error":
                raise LarkupError(event.error or "Chat request failed")
            output += event.text or ""
        return output

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        await self._client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
