import os
from typing import Any, Dict, Literal, Optional
from urllib.parse import quote

import httpx

from .client import _handle_error
from .types import (
    LarkupHubClientOptions,
    ToolDetailResponse,
    ToolListResponse,
)


class LarkupHubClient:
    """Synchronous client for the Larkup Marketplace Hub catalog."""

    def __init__(self, options: Optional[LarkupHubClientOptions] = None):
        options = options or LarkupHubClientOptions()
        base_url = options.base_url or os.getenv("LARKUP_HUB_URL", "https://hub.larkup.de")
        self.base_url = base_url.rstrip("/")
        self.api_key = options.api_key
        self._client = httpx.Client(base_url=self.base_url)

    def _get(self, path: str, **kwargs: Any) -> Dict[str, Any]:
        headers = (
            {"Authorization": f"Bearer {self.api_key}"}
            if self.api_key
            else {}
        )
        response = self._client.get(path, headers=headers, **kwargs)
        _handle_error(response)
        return response.json()

    def list_tools(
        self,
        *,
        category: Optional[
            Literal[
                "media",
                "search",
                "analytics",
                "integration",
                "embedding",
                "ai",
                "automation",
                "utility",
            ]
        ] = None,
        search: Optional[str] = None,
        page: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> ToolListResponse:
        """List Marketplace tools with optional filters."""
        params = {
            key: value
            for key, value in {
                "category": category,
                "search": search,
                "page": page,
                "limit": limit,
            }.items()
            if value is not None
        }
        return ToolListResponse(**self._get("/v1/tools", params=params))

    def get_tool(self, id: str) -> ToolDetailResponse:
        """Return one Marketplace tool and its version history."""
        return ToolDetailResponse(**self._get(f"/v1/tools/{quote(id, safe='')}"))

    def close(self) -> None:
        """Close the underlying HTTP client."""
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


class AsyncLarkupHubClient:
    """Asynchronous client for the Larkup Marketplace Hub catalog."""

    def __init__(self, options: Optional[LarkupHubClientOptions] = None):
        options = options or LarkupHubClientOptions()
        base_url = options.base_url or os.getenv("LARKUP_HUB_URL", "https://hub.larkup.de")
        self.base_url = base_url.rstrip("/")
        self.api_key = options.api_key
        self._client = httpx.AsyncClient(base_url=self.base_url)

    async def _get(self, path: str, **kwargs: Any) -> Dict[str, Any]:
        headers = (
            {"Authorization": f"Bearer {self.api_key}"}
            if self.api_key
            else {}
        )
        response = await self._client.get(path, headers=headers, **kwargs)
        _handle_error(response)
        return response.json()

    async def list_tools(
        self,
        *,
        category: Optional[str] = None,
        search: Optional[str] = None,
        page: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> ToolListResponse:
        """List Marketplace tools with optional filters."""
        params = {
            key: value
            for key, value in {
                "category": category,
                "search": search,
                "page": page,
                "limit": limit,
            }.items()
            if value is not None
        }
        return ToolListResponse(**await self._get("/v1/tools", params=params))

    async def get_tool(self, id: str) -> ToolDetailResponse:
        """Return one Marketplace tool and its version history."""
        return ToolDetailResponse(
            **await self._get(f"/v1/tools/{quote(id, safe='')}")
        )

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        await self._client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
