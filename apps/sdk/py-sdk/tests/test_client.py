import pytest
import respx
from httpx import Response
from larkup import LarkupClient, AsyncLarkupClient, Document, LarkupClientOptions

BASE_URL = "http://localhost:8080"

@pytest.fixture
def sync_client():
    options = LarkupClientOptions(base_url=BASE_URL, api_key="test-key")
    return LarkupClient(options)

@pytest.fixture
def async_client():
    options = LarkupClientOptions(base_url=BASE_URL, api_key="test-key")
    return AsyncLarkupClient(options)

@respx.mock
def test_health_sync(sync_client):
    respx.get(f"{BASE_URL}/health").mock(return_value=Response(200, json={"ok": True, "service": "larkup"}))
    response = sync_client.health()
    assert response.ok is True
    assert response.service == "larkup"

@respx.mock
@pytest.mark.asyncio
async def test_health_async(async_client):
    respx.get(f"{BASE_URL}/health").mock(return_value=Response(200, json={"ok": True, "service": "larkup"}))
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
                "documentId": "doc1"
            }
        ]
    }
    respx.post(f"{BASE_URL}/query").mock(return_value=Response(200, json=mock_response))
    response = sync_client.query("test query", top_k=5)
    assert response.query == "test query"
    assert len(response.hits) == 1
    assert response.hits[0].score == 0.99
    assert response.hits[0].id == "hit1"

@respx.mock
@pytest.mark.asyncio
async def test_query_async(async_client):
    mock_response = {
        "query": "async query",
        "hits": []
    }
    respx.post(f"{BASE_URL}/query").mock(return_value=Response(200, json=mock_response))
    response = await async_client.query("async query")
    assert response.query == "async query"
    assert len(response.hits) == 0

@respx.mock
def test_add_document_sync(sync_client):
    respx.post(f"{BASE_URL}/documents").mock(return_value=Response(200, json={"success": True, "id": "new-doc-id"}))
    doc = Document(id="temp", text="hello world", title="test")
    response = sync_client.add_document(doc)
    assert response["success"] is True
    assert response["id"] == "new-doc-id"

@respx.mock
def test_get_document_sync(sync_client):
    respx.get(f"{BASE_URL}/documents/doc1").mock(return_value=Response(200, json={
        "id": "doc1",
        "text": "content",
        "title": "A Title",
    }))
    doc = sync_client.get_document("doc1")
    assert doc.id == "doc1"
    assert doc.text == "content"
    assert doc.title == "A Title"
