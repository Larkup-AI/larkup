import asyncio
import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import (
    Any,
    AsyncIterator,
    Dict,
    Iterator,
    Literal,
    Optional,
    Sequence,
    Union,
)
from urllib.parse import quote

import httpx

from .types import (
    AgentChatRequest,
    ChatEvent,
    ChatModel,
    ChatModelCatalog,
    ChatProvider,
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
    AgentTool,
    AgentCapability,
    AgentRuntimeConfiguration,
    AgentSandboxStatus,
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


def _agent_stream_text(line: str) -> Optional[str]:
    """Extract a text delta from one Agent Server stream line."""
    try:
        if line.startswith("0:"):
            value = json.loads(line[2:])
            return value if isinstance(value, str) else None
        if not line.startswith("data:"):
            return None

        event = json.loads(line[len("data:") :].strip())
        if not isinstance(event, dict) or event.get("type") != "text-delta":
            return None
        value = event.get("delta", event.get("text"))
        return value if isinstance(value, str) else None
    except (json.JSONDecodeError, AttributeError):
        return None


def _group_agent_tools(tools: list[AgentTool]) -> list[AgentCapability]:
    groups: Dict[str, AgentCapability] = {}
    for tool in tools:
        source = tool.source or "built-in"
        identifier = (
            f"mcp:{tool.connectionId or 'remote'}"
            if source == "mcp"
            else f"plugin:{tool.pluginId or 'plugin'}"
            if source == "plugin"
            else source
        )
        name = (
            f"MCP · {tool.connectionId or 'Remote server'}"
            if source == "mcp"
            else f"Plugin · {tool.pluginId or 'Plugin'}"
            if source == "plugin"
            else "Sandbox"
            if source == "sandbox"
            else "Built-in tools"
        )
        group = groups.get(identifier)
        if group is None:
            group = AgentCapability(
                id=identifier,
                name=name,
                source=source,
                connectionId=tool.connectionId,
                pluginId=tool.pluginId,
                tools=[],
            )
            groups[identifier] = group
        group.tools.append(tool)
    return list(groups.values())


class LarkupAgentClient:
    """Synchronous client for one generated Larkup Agent Server."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        *,
        api_key: Optional[str] = None,
        join_code: Optional[str] = None,
        timeout: float = 120.0,
    ):
        self.base_url = (
            base_url or os.getenv("LARKUP_AGENT_URL", "http://localhost:8081")
        ).rstrip("/")
        self.api_key = api_key or os.getenv("LARKUP_AGENT_API_KEY")
        self.join_code = join_code or os.getenv("LARKUP_AGENT_JOIN_CODE")
        self._client = httpx.Client(base_url=self.base_url, timeout=timeout)

    def _headers(self) -> Dict[str, str]:
        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if self.join_code:
            headers["X-Larkup-Join-Code"] = self.join_code
        return headers

    def info(self) -> Dict[str, Any]:
        response = self._client.get("/agent", headers=self._headers())
        _handle_error(response)
        return response.json()

    def health(self) -> Dict[str, Any]:
        """Check whether the local or deployed Agent Server is reachable."""
        response = self._client.get("/health", headers=self._headers())
        _handle_error(response)
        return response.json()

    def open_api(self) -> Dict[str, Any]:
        """Fetch the OpenAPI document also rendered by Scalar at /reference."""
        response = self._client.get("/openapi.json", headers=self._headers())
        _handle_error(response)
        return response.json()

    def tools(self) -> list[AgentTool]:
        """List every tool currently loaded by this Agent Server."""
        response = self._client.get("/agent/tools", headers=self._headers())
        _handle_error(response)
        return [AgentTool(**tool) for tool in response.json().get("tools", [])]

    def capabilities(self) -> list[AgentCapability]:
        """List integrations as grouped capabilities, including one group per MCP connection."""
        response = self._client.get("/agent/capabilities", headers=self._headers())
        if response.status_code == 404:
            return _group_agent_tools(self.tools())
        _handle_error(response)
        return [
            AgentCapability(**capability)
            for capability in response.json().get("capabilities", [])
        ]

    def configuration(self) -> AgentRuntimeConfiguration:
        """Read the Agent prompt and enabled skill metadata saved for this runtime."""
        response = self._client.get("/agent/configuration", headers=self._headers())
        _handle_error(response)
        return AgentRuntimeConfiguration(**response.json())

    def sandbox(self) -> AgentSandboxStatus:
        """Check the configured Agent code-execution environment without exposing credentials."""
        response = self._client.get("/agent/sandbox", headers=self._headers())
        _handle_error(response)
        return AgentSandboxStatus(**response.json())

    def chat_model_catalog(self, provider: Optional[str] = None) -> ChatModelCatalog:
        """List the chat providers and models available to this Agent Runtime."""
        path = "/models" if not provider else f"/models?provider={quote(provider, safe='')}"
        response = self._client.get(path, headers=self._headers())
        _handle_error(response)
        return ChatModelCatalog(**response.json())

    def chat_providers(self) -> list[ChatProvider]:
        """List chat model vendors available to this Agent Runtime."""
        return self.chat_model_catalog().providers

    def chat_models(self, provider: Optional[str] = None) -> list[ChatModel]:
        """List chat models, optionally filtered by their vendor."""
        return self.chat_model_catalog(provider).models

    def _chat_payload(
        self, message: Union[str, Sequence[Dict[str, str]], AgentChatRequest]
    ) -> Dict[str, Any]:
        if isinstance(message, str):
            return {"messages": [{"role": "user", "content": message}]}
        if isinstance(message, AgentChatRequest):
            return message.model_dump(exclude_none=True)
        return {"messages": message}

    def chat(
        self, message: Union[str, Sequence[Dict[str, str]], AgentChatRequest]
    ) -> httpx.Response:
        response = self._client.post(
            "/chat", headers=self._headers(), json=self._chat_payload(message)
        )
        _handle_error(response)
        return response

    def stream_text(
        self, message: Union[str, Sequence[Dict[str, str]], AgentChatRequest]
    ) -> Iterator[str]:
        """Yield plain assistant text as it arrives from the Agent Server."""
        with self._client.stream(
            "POST",
            "/chat",
            headers=self._headers(),
            json=self._chat_payload(message),
        ) as response:
            _handle_error(response)
            for line in response.iter_lines():
                text = _agent_stream_text(line)
                if text is not None:
                    yield text

    def chat_text(
        self, message: Union[str, Sequence[Dict[str, str]], AgentChatRequest]
    ) -> str:
        """Collect text via the streaming path so slow tool calls do not time out."""
        return "".join(self.stream_text(message))

    def close(self) -> None:
        self._client.close()


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
        base_url = options.base_url or os.getenv(
            "LARKUP_API_URL", "http://localhost:8080"
        )
        self.base_url = base_url.rstrip("/")
        self.api_key = options.api_key or os.getenv("LARKUP_API_KEY")
        self._client = httpx.Client(base_url=self.base_url)

    def _headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}

    def chat_model_catalog(self, provider: Optional[str] = None) -> ChatModelCatalog:
        """List chat providers and models available to this deployment."""
        path = "/models" if not provider else f"/models?provider={quote(provider, safe='')}"
        response = self._client.get(path, headers=self._headers())
        _handle_error(response)
        return ChatModelCatalog(**response.json())

    def chat_providers(self) -> list[ChatProvider]:
        """List chat model vendors available to this deployment."""
        return self.chat_model_catalog().providers

    def chat_models(self, provider: Optional[str] = None) -> list[ChatModel]:
        """List chat models, optionally filtered by their vendor."""
        return self.chat_model_catalog(provider).models

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

    # The media endpoints live on the dashboard's API
    # ("http://localhost:4567/api" by default), not on a generated Knowledge
    # Server: indexing media needs the workspace, ffmpeg, and the media store,
    # none of which a deployed server carries. Point base_url at the dashboard
    # to use them.

    def list_media(self) -> MediaListResponse:
        return MediaListResponse(**self._request("GET", "/media"))

    def get_media(self, id: str) -> MediaAsset:
        return MediaAsset(**self._request("GET", f"/media/{quote(id, safe='')}"))

    def delete_media(self, id: str) -> Dict[str, Any]:
        return self._request("DELETE", f"/media/{quote(id, safe='')}")

    def get_media_job_status(self, job_id: str) -> MediaJobStatus:
        return MediaJobStatus(
            **self._request("GET", f"/media/jobs/{quote(job_id, safe='')}")
        )

    def approve_refinement(self, job_id: str) -> RefinementDecisionResponse:
        return RefinementDecisionResponse(
            **self._request(
                "POST",
                f"/media/jobs/{quote(job_id, safe='')}/approval",
                json={"decision": "approve"},
            )
        )

    def decline_refinement(self, job_id: str) -> RefinementDecisionResponse:
        return RefinementDecisionResponse(
            **self._request(
                "POST",
                f"/media/jobs/{quote(job_id, safe='')}/approval",
                json={"decision": "decline"},
            )
        )

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
        base_url = options.base_url or os.getenv(
            "LARKUP_API_URL", "http://localhost:8080"
        )
        self.base_url = base_url.rstrip("/")
        self.api_key = options.api_key or os.getenv("LARKUP_API_KEY")
        self._client = httpx.AsyncClient(base_url=self.base_url)

    def _headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}

    async def chat_model_catalog(self, provider: Optional[str] = None) -> ChatModelCatalog:
        """List chat providers and models available to this deployment."""
        path = "/models" if not provider else f"/models?provider={quote(provider, safe='')}"
        response = await self._client.get(path, headers=self._headers())
        _handle_error(response)
        return ChatModelCatalog(**response.json())

    async def chat_providers(self) -> list[ChatProvider]:
        """List chat model vendors available to this deployment."""
        return (await self.chat_model_catalog()).providers

    async def chat_models(self, provider: Optional[str] = None) -> list[ChatModel]:
        """List chat models, optionally filtered by their vendor."""
        return (await self.chat_model_catalog(provider)).models

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

    async def list_documents(
        self, page: int = 1, limit: int = 20
    ) -> PaginatedDocuments:
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
        return MediaJobStatus(
            **await self._request("GET", f"/media/jobs/{quote(job_id, safe='')}")
        )

    async def approve_refinement(self, job_id: str) -> RefinementDecisionResponse:
        return RefinementDecisionResponse(
            **await self._request(
                "POST",
                f"/media/jobs/{quote(job_id, safe='')}/approval",
                json={"decision": "approve"},
            )
        )

    async def decline_refinement(self, job_id: str) -> RefinementDecisionResponse:
        return RefinementDecisionResponse(
            **await self._request(
                "POST",
                f"/media/jobs/{quote(job_id, safe='')}/approval",
                json={"decision": "decline"},
            )
        )

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
