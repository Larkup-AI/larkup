"""
Python SDK E2E test script.
Usage:
    python py_sdk_test.py sync     # Test synchronous client
    python py_sdk_test.py async    # Test async client
"""
import sys
import os
import json
import traceback

BASE_URL = os.getenv("LARKUP_API_URL", "http://localhost:8080")


def test_sync():
    """Test the synchronous LarkupClient."""
    from larkup import LarkupClient, LarkupClientOptions  # type: ignore[import-not-found]

    client = LarkupClient(LarkupClientOptions(base_url=BASE_URL))
    results = []

    # 1. Health check
    try:
        health = client.health()
        assert health.ok, f"Health check returned ok={health.ok}"
        results.append("✓ health")
    except Exception as e:
        results.append(f"✗ health: {e}")

    # 2. Query
    try:
        response = client.query("What is Larkup?", top_k=3)
        assert hasattr(response, "hits"), "Query response missing 'hits'"
        assert hasattr(response, "query"), "Query response missing 'query'"
        results.append(f"✓ query ({len(response.hits)} hits)")
    except Exception as e:
        results.append(f"✗ query: {e}")

    # 3. List documents
    try:
        docs = client.list_documents(page=1, limit=5)
        assert hasattr(docs, "documents"), "list_documents missing 'documents'"
        results.append(f"✓ list_documents ({len(docs.documents)} docs)")
    except Exception as e:
        results.append(f"✗ list_documents: {e}")

    # 4. Add document
    try:
        from larkup.types import Document  # type: ignore[import-not-found]
        doc = Document(id="", text="Python SDK E2E test content", title="Py SDK Test")
        result = client.add_document(doc)
        assert result.get("success"), f"add_document returned {result}"
        doc_id = result.get("id", "")
        results.append(f"✓ add_document (id={doc_id})")

        # Cleanup
        if doc_id:
            client.delete_document(doc_id)
            results.append("✓ delete_document")
    except Exception as e:
        results.append(f"✗ add_document: {e}")

    client.close()

    for r in results:
        print(f"  {r}")

    if all("✓" in r for r in results):
        print("\nPASS — All sync tests passed")
    else:
        print("\nFAIL — Some sync tests failed")
        sys.exit(1)


async def test_async():
    """Test the async AsyncLarkupClient."""
    from larkup import AsyncLarkupClient, LarkupClientOptions  # type: ignore[import-not-found]

    client = AsyncLarkupClient(LarkupClientOptions(base_url=BASE_URL))
    results = []

    # 1. Health check
    try:
        health = await client.health()
        assert health.ok, f"Health check returned ok={health.ok}"
        results.append("✓ async health")
    except Exception as e:
        results.append(f"✗ async health: {e}")

    # 2. Query
    try:
        response = await client.query("What is Larkup?", top_k=3)
        assert hasattr(response, "hits"), "Query response missing 'hits'"
        results.append(f"✓ async query ({len(response.hits)} hits)")
    except Exception as e:
        results.append(f"✗ async query: {e}")

    # 3. List documents
    try:
        docs = await client.list_documents(page=1, limit=5)
        assert hasattr(docs, "documents"), "list_documents missing 'documents'"
        results.append(f"✓ async list_documents ({len(docs.documents)} docs)")
    except Exception as e:
        results.append(f"✗ async list_documents: {e}")

    await client.close()

    for r in results:
        print(f"  {r}")

    if all("✓" in r for r in results):
        print("\nPASS — All async tests passed")
    else:
        print("\nFAIL — Some async tests failed")
        sys.exit(1)


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "sync"

    try:
        if mode == "sync":
            print("Running Python SDK sync tests...")
            test_sync()
        elif mode == "async":
            import asyncio
            print("Running Python SDK async tests...")
            asyncio.run(test_async())
        else:
            print(f"Unknown mode: {mode}. Use 'sync' or 'async'.")
            sys.exit(1)
    except Exception as e:
        print(f"\nFAIL — {e}")
        traceback.print_exc()
        sys.exit(1)
