import respx
import pytest
from httpx import Response

from larkup import (
    AsyncLarkupHubClient,
    LarkupHubClient,
    LarkupHubClientOptions,
)


@respx.mock
def test_list_and_get_tools():
    base_url = "http://hub.local"
    list_route = respx.get(f"{base_url}/v1/tools").mock(
        return_value=Response(200, json={"tools": [], "total": 0})
    )
    respx.get(f"{base_url}/v1/tools/video-audio").mock(
        return_value=Response(
            200,
            json={
                "tool": {
                    "id": "video-audio",
                    "name": "Video & Audio",
                    "description": "Index media",
                    "category": "media",
                    "version": "0.1.0",
                    "pricing": "free",
                    "icon": "Film",
                    "packageName": "@larkup/tool-video-audio",
                    "installSize": "15 MB",
                    "author": "Larkup",
                    "capabilities": ["video-indexing"],
                    "downloads": 1,
                },
                "installs": 1,
                "versions": [],
            },
        )
    )

    with LarkupHubClient(
        LarkupHubClientOptions(base_url=base_url)
    ) as client:
        tools = client.list_tools(category="media", page=1, limit=10)
        detail = client.get_tool("video-audio")

    assert tools.total == 0
    assert list_route.calls[0].request.url.params["category"] == "media"
    assert detail.tool.id == "video-audio"


@respx.mock
@pytest.mark.asyncio
async def test_async_list_tools():
    base_url = "http://hub.local"
    respx.get(f"{base_url}/v1/tools").mock(
        return_value=Response(200, json={"tools": [], "total": 0})
    )

    async with AsyncLarkupHubClient(
        LarkupHubClientOptions(base_url=base_url)
    ) as client:
        tools = await client.list_tools(search="editor")

    assert tools.total == 0
