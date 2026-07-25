import os
import sys
import traceback

BASE_URL = os.getenv("LARKUP_API_URL", "http://localhost:8080")


def test_sync():
    from larkup import LarkupClient, LarkupClientOptions

    client = LarkupClient(LarkupClientOptions(base_url=BASE_URL))
    results = []

    try:
        health = client.health()
        assert health.ok, f"Health check returned ok={health.ok}"
        results.append("✓ health")
    except Exception as e:
        results.append(f"✗ health: {e}")

    try:
        response = client.query("What is Larkup?", top_k=3)
        assert hasattr(response, "hits"), "Query response missing 'hits'"
        assert hasattr(response, "query"), "Query response missing 'query'"
        results.append(f"✓ query ({len(response.hits)} hits)")
    except Exception as e:
        results.append(f"✗ query: {e}")

    try:
        docs = client.list_documents(page=1, limit=5)
        assert hasattr(docs, "documents"), "list_documents missing 'documents'"
        results.append(f"✓ list_documents ({len(docs.documents)} docs)")
    except Exception as e:
        results.append(f"✗ list_documents: {e}")

    try:
        from larkup import Document
        doc = Document(text="Python SDK E2E test content", title="Py SDK Test")
        result = client.add_document(doc)
        assert result.get("success"), f"add_document returned {result}"
        doc_id = result.get("id", "")
        results.append(f"✓ add_document (id={doc_id})")

        if doc_id:
            client.delete_document(doc_id)
            results.append("✓ delete_document")
    except Exception as e:
        results.append(f"✗ add_document: {e}")

    try:
        summary = client.corpus_summary()
        assert summary.totalDocuments >= 0
        corpus = client.corpus()
        assert hasattr(corpus, "documents")
        results.append("✓ corpus")
    except Exception as e:
        results.append(f"✗ corpus: {e}")

    client.close()

    for r in results:
        print(f"  {r}")

    if all("✓" in r for r in results):
        print("\nPASS — All sync tests passed")
    else:
        print("\nFAIL — Some sync tests failed")
        sys.exit(1)


async def test_async():
    from larkup import AsyncLarkupClient, LarkupClientOptions

    client = AsyncLarkupClient(LarkupClientOptions(base_url=BASE_URL))
    results = []

    try:
        health = await client.health()
        assert health.ok, f"Health check returned ok={health.ok}"
        results.append("✓ async health")
    except Exception as e:
        results.append(f"✗ async health: {e}")

    try:
        response = await client.query("What is Larkup?", top_k=3)
        assert hasattr(response, "hits"), "Query response missing 'hits'"
        results.append(f"✓ async query ({len(response.hits)} hits)")
    except Exception as e:
        results.append(f"✗ async query: {e}")

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
