import json

import respx
import pytest
import pytest_asyncio
from httpx import Response
from larkup import (
    AgentChatRequest,
    AsyncLarkupClient,
    CorpusFilter,
    CorpusRequest,
    Document,
    LarkupClient,
    LarkupClientOptions,
    LarkupAgentClient,
)

BASE_URL = "http://localhost:8080"


@pytest.fixture
def sync_client():
    options = LarkupClientOptions(base_url=BASE_URL, api_key="test-key")
    with LarkupClient(options) as client:
        yield client


@pytest_asyncio.fixture
async def async_client():
    options = LarkupClientOptions(base_url=BASE_URL, api_key="test-key")
    async with AsyncLarkupClient(options) as client:
        yield client


@respx.mock
def test_health_sync(sync_client):
    respx.get(f"{BASE_URL}/health").mock(
        return_value=Response(200, json={"ok": True, "service": "larkup"})
    )
    response = sync_client.health()
    assert response.ok is True
    assert response.service == "larkup"


@respx.mock
def test_agent_runtime_discovery():
    base_url = "http://localhost:8083"
    respx.get(f"{base_url}/health").mock(
        return_value=Response(200, json={"status": "ok", "agentId": "demo-agent"})
    )
    respx.get(f"{base_url}/openapi.json").mock(
        return_value=Response(
            200,
            json={
                "openapi": "3.1.0",
                "info": {"title": "Demo", "version": "1.0.0"},
                "paths": {},
            },
        )
    )
    respx.get(f"{base_url}/agent/tools").mock(
        return_value=Response(
            200,
            json={
                "tools": [
                    {
                        "id": "searchKnowledgeBase",
                        "name": "Search Knowledge Base",
                        "description": "Search.",
                    }
                ]
            },
        )
    )

    agent = LarkupAgentClient(base_url=base_url)
    try:
        assert agent.health()["agentId"] == "demo-agent"
        assert agent.open_api()["openapi"] == "3.1.0"
        assert agent.tools()[0].id == "searchKnowledgeBase"
    finally:
        agent.close()


@respx.mock
def test_agent_runtime_reads_ui_message_stream():
    base_url = "http://localhost:8083"
    respx.post(f"{base_url}/chat").mock(
        return_value=Response(
            200,
            text='data: {"type":"text-delta","delta":"Tool-aware "}\n\ndata: {"type":"text-delta","delta":"answer"}\n\n',
            headers={"content-type": "text/event-stream"},
        )
    )

    agent = LarkupAgentClient(base_url=base_url)
    try:
        assert agent.chat_text("hello") == "Tool-aware answer"
    finally:
        agent.close()


@respx.mock
def test_agent_runtime_discovers_models_and_forwards_selection():
    base_url = "http://localhost:8083"
    respx.get(f"{base_url}/models?provider=anthropic").mock(
        return_value=Response(
            200,
            json={
                "configuredProvider": "vercel_ai_gateway",
                "configuredModelId": "openai/gpt-4o-mini",
                "source": "vercel-ai-gateway",
                "providers": [{"id": "anthropic", "name": "Anthropic", "modelCount": 1}],
                "models": [
                    {
                        "id": "anthropic/claude-sonnet-4",
                        "name": "Claude Sonnet",
                        "provider": "anthropic",
                    }
                ],
            },
        )
    )
    route = respx.post(f"{base_url}/chat").mock(
        return_value=Response(
            200,
            text='0:"Configured model"\n',
            headers={"content-type": "text/event-stream"},
        )
    )

    agent = LarkupAgentClient(base_url=base_url)
    try:
        assert agent.chat_models("anthropic")[0].id == "anthropic/claude-sonnet-4"
        assert agent.chat_text(
            AgentChatRequest(
                messages=[{"role": "user", "content": "Hello"}],
                provider="vercel_ai_gateway",
                modelId="anthropic/claude-sonnet-4",
            )
        ) == "Configured model"
        assert json.loads(route.calls[0].request.content)["modelId"] == "anthropic/claude-sonnet-4"
    finally:
        agent.close()


@respx.mock
def test_agent_runtime_reports_mcp_capabilities():
    base_url = "http://localhost:8083"
    respx.get(f"{base_url}/agent/capabilities").mock(
        return_value=Response(
            200,
            json={
                "capabilities": [
                    {
                        "id": "mcp:demo",
                        "name": "MCP · Demo",
                        "source": "mcp",
                        "connectionId": "demo",
                        "tools": [
                            {
                                "id": "mcp_demo_lookup",
                                "name": "lookup",
                                "description": "MCP tool from Demo",
                                "source": "mcp",
                                "connectionId": "demo",
                            }
                        ],
                    }
                ]
            },
        )
    )

    agent = LarkupAgentClient(base_url=base_url)
    try:
        capabilities = agent.capabilities()
        assert capabilities[0].source == "mcp"
        assert capabilities[0].connectionId == "demo"
        assert capabilities[0].tools[0].id == "mcp_demo_lookup"
    finally:
        agent.close()


@respx.mock
def test_agent_runtime_groups_raw_tools_from_an_older_runtime():
    base_url = "http://localhost:8083"
    respx.get(f"{base_url}/agent/capabilities").mock(return_value=Response(404))
    respx.get(f"{base_url}/agent/tools").mock(
        return_value=Response(
            200,
            json={
                "tools": [
                    {
                        "id": "mcp_demo_lookup",
                        "name": "lookup",
                        "description": "MCP tool from Demo",
                        "source": "mcp",
                        "connectionId": "demo",
                    }
                ]
            },
        )
    )

    agent = LarkupAgentClient(base_url=base_url)
    try:
        capabilities = agent.capabilities()
        assert capabilities[0].id == "mcp:demo"
        assert capabilities[0].tools[0].id == "mcp_demo_lookup"
    finally:
        agent.close()


@respx.mock
def test_agent_runtime_reads_prompt_and_skills():
    base_url = "http://localhost:8083"
    respx.get(f"{base_url}/agent/configuration").mock(
        return_value=Response(
            200,
            json={
                "systemPrompt": "Always cite sources.",
                "enabledTools": [
                    {"id": "searchKnowledgeBase", "name": "Semantic Search", "description": "Search the RAG knowledge base."}
                ],
                "sandbox": {"provider": "e2b", "configured": True, "enabled": True},
                "skills": [
                    {"id": "research", "name": "Research", "description": "Research workflow."}
                ],
            },
        )
    )

    agent = LarkupAgentClient(base_url=base_url)
    try:
        configuration = agent.configuration()
        assert configuration.systemPrompt == "Always cite sources."
        assert configuration.skills[0].id == "research"
        assert configuration.enabledTools[0]["id"] == "searchKnowledgeBase"
        assert configuration.sandbox["provider"] == "e2b"
    finally:
        agent.close()


@respx.mock
def test_agent_runtime_reports_sandbox_status():
    base_url = "http://localhost:8083"
    respx.get(f"{base_url}/agent/sandbox").mock(
        return_value=Response(200, json={"provider": "e2b", "configured": True, "status": "ready"})
    )

    agent = LarkupAgentClient(base_url=base_url)
    try:
        assert agent.sandbox().provider == "e2b"
        assert agent.sandbox().status == "ready"
    finally:
        agent.close()


@respx.mock
def test_agent_runtime_streams_text_as_it_arrives():
    base_url = "http://localhost:8083"
    respx.post(f"{base_url}/chat").mock(
        return_value=Response(
            200,
            text='0:"Tool-aware "\n0:"streaming answer"\n',
            headers={"content-type": "text/event-stream"},
        )
    )

    agent = LarkupAgentClient(base_url=base_url)
    try:
        assert list(agent.stream_text("hello")) == ["Tool-aware ", "streaming answer"]
    finally:
        agent.close()


@respx.mock
@pytest.mark.asyncio
async def test_health_async(async_client):
    respx.get(f"{BASE_URL}/health").mock(
        return_value=Response(200, json={"ok": True, "service": "larkup"})
    )
    response = await async_client.health()
    assert response.ok is True
    assert response.service == "larkup"


@respx.mock
def test_query_sync(sync_client):
    mock_response = {
        "query": "test query",
        "hits": [
            {
                "id": "hit1",
                "score": 0.99,
                "text": "test text",
                "title": "test title",
                "documentId": "doc1",
            }
        ],
    }
    route = respx.post(f"{BASE_URL}/query").mock(
        return_value=Response(200, json=mock_response)
    )
    response = sync_client.query("test query", top_k=5)
    assert response.query == "test query"
    assert len(response.hits) == 1
    assert response.hits[0].score == 0.99
    assert response.hits[0].id == "hit1"
    assert route.calls[0].request.headers["authorization"] == "Bearer test-key"


@respx.mock
@pytest.mark.asyncio
async def test_query_async(async_client):
    mock_response = {"query": "async query", "hits": []}
    respx.post(f"{BASE_URL}/query").mock(return_value=Response(200, json=mock_response))
    response = await async_client.query("async query")
    assert response.query == "async query"
    assert len(response.hits) == 0


@respx.mock
def test_add_document_sync(sync_client):
    respx.post(f"{BASE_URL}/documents").mock(
        return_value=Response(200, json={"success": True, "id": "new-doc-id"})
    )
    doc = Document(id="temp", text="hello world", title="test")
    response = sync_client.add_document(doc)
    assert response["success"] is True
    assert response["id"] == "new-doc-id"


@respx.mock
def test_get_document_sync(sync_client):
    respx.get(f"{BASE_URL}/documents/doc1").mock(
        return_value=Response(
            200,
            json={
                "id": "doc1",
                "text": "content",
                "title": "A Title",
            },
        )
    )
    doc = sync_client.get_document("doc1")
    assert doc.id == "doc1"
    assert doc.text == "content"
    assert doc.title == "A Title"


@respx.mock
def test_chat_sync(sync_client):
    stream = (
        'event: message\ndata: {"type":"text-delta","text":"Hello "}\n\n'
        'event: message\ndata: {"type":"text-delta","text":"world"}\n\n'
        'event: done\ndata: {"type":"done","hits":[]}\n\n'
    )
    route = respx.post(f"{BASE_URL}/chat").mock(
        return_value=Response(
            200, text=stream, headers={"content-type": "text/event-stream"}
        )
    )

    assert sync_client.chat_text("hello") == "Hello world"
    assert route.calls[0].request.headers["authorization"] == "Bearer test-key"


@respx.mock
@pytest.mark.asyncio
async def test_chat_async(async_client):
    stream = (
        'data: {"type":"text-delta","text":"Async "}\n\n'
        'data: {"type":"text-delta","text":"chat"}\n\n'
    )
    respx.post(f"{BASE_URL}/chat").mock(
        return_value=Response(
            200, text=stream, headers={"content-type": "text/event-stream"}
        )
    )

    assert await async_client.chat_text("hello") == "Async chat"


@respx.mock
def test_media_management_sync(sync_client):
    asset = {
        "id": "media-1",
        "type": "video",
        "fileName": "demo.mp4",
        "mimeType": "video/mp4",
        "storageUri": "media://demo",
        "fileSize": 42,
        "processingStatus": "completed",
        "documentIds": ["doc-1"],
        "createdAt": "2026-08-06T00:00:00Z",
    }
    respx.get(f"{BASE_URL}/media").mock(
        return_value=Response(200, json={"assets": [asset], "total": 1})
    )
    respx.get(f"{BASE_URL}/media/media-1").mock(return_value=Response(200, json=asset))
    respx.get(f"{BASE_URL}/media/jobs/job-1").mock(
        return_value=Response(
            200,
            json={
                "id": "job-1",
                "status": "completed",
                "attempt": 1,
                "createdAt": "2026-08-06T00:00:00Z",
                "updatedAt": "2026-08-06T00:00:01Z",
            },
        )
    )
    respx.post(f"{BASE_URL}/media/jobs/ref-1/approval").mock(
        return_value=Response(200, json={"job": {"id": "ref-1", "status": "queued"}})
    )

    assert sync_client.list_media().assets[0].id == "media-1"
    assert sync_client.get_media("media-1").fileName == "demo.mp4"
    assert sync_client.get_media_job_status("job-1").status == "completed"
    assert sync_client.approve_refinement("ref-1").job["status"] == "queued"


@respx.mock
@pytest.mark.asyncio
async def test_media_management_async(async_client):
    respx.get(f"{BASE_URL}/media").mock(
        return_value=Response(200, json={"assets": [], "total": 0})
    )
    respx.post(f"{BASE_URL}/media/jobs/ref-2/approval").mock(
        return_value=Response(200, json={"job": {"id": "ref-2", "status": "declined"}})
    )

    assert (await async_client.list_media()).total == 0
    assert (await async_client.decline_refinement("ref-2")).job["status"] == "declined"


@respx.mock
def test_corpus_operations_sync(sync_client):
    respx.get(f"{BASE_URL}/corpus/summary").mock(
        return_value=Response(
            200,
            json={
                "totalDocuments": 3,
                "bySource": {"upload": 3},
                "byStatus": {"indexed": 3},
                "totalCharacters": 120,
            },
        )
    )
    corpus_route = respx.post(f"{BASE_URL}/corpus").mock(
        return_value=Response(
            200,
            json={"documents": [], "total": 0, "page": 1, "limit": 10},
        )
    )
    respx.post(f"{BASE_URL}/corpus/export").mock(
        return_value=Response(200, text='{"id":"doc-1"}\n')
    )

    assert sync_client.corpus_summary().totalDocuments == 3
    response = sync_client.corpus(
        CorpusRequest(
            filter=CorpusFilter(titleContains="guide"),
            limit=10,
            includeContent=True,
        )
    )
    assert response.total == 0
    assert b'"titleContains":"guide"' in corpus_route.calls[0].request.content
    assert sync_client.export_corpus("jsonl") == '{"id":"doc-1"}\n'


@respx.mock
def test_index_documents_streams_progress(sync_client):
    route = respx.post(f"{BASE_URL}/documents").mock(
        side_effect=[
            Response(200, json={"success": True, "id": "one"}),
            Response(200, json={"success": True, "id": "two"}),
        ]
    )

    events = list(
        sync_client.index_documents(
            [Document(text="one"), Document(text="two")],
            mode="parallel",
            concurrency=2,
        )
    )

    assert route.call_count == 2
    assert len(events) == 3
    assert events[-1].type == "complete"
    assert events[-1].succeeded == 2


@respx.mock
def test_index_documents_can_continue_after_error(sync_client):
    respx.post(f"{BASE_URL}/documents").mock(
        side_effect=[
            Response(429, json={"error": "Rate limited"}),
            Response(200, json={"success": True, "id": "two"}),
        ]
    )

    events = list(
        sync_client.index_documents(
            [Document(text="one"), Document(text="two")],
            mode="parallel",
            concurrency=2,
            continue_on_error=True,
        )
    )

    assert events[-1].succeeded == 1
    assert events[-1].failed == 1


@respx.mock
@pytest.mark.asyncio
async def test_index_documents_async(async_client):
    respx.post(f"{BASE_URL}/documents").mock(
        side_effect=[
            Response(200, json={"success": True, "id": "one"}),
            Response(200, json={"success": True, "id": "two"}),
        ]
    )
    events = [
        event
        async for event in async_client.index_documents(
            [Document(text="one"), Document(text="two")],
            mode="parallel",
            concurrency=2,
        )
    ]

    assert events[-1].type == "complete"
    assert events[-1].completed == 2
