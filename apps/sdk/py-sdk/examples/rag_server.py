import os

from larkup import Document, LarkupClient, LarkupClientOptions


options = LarkupClientOptions(
    base_url=os.getenv("LARKUP_API_URL", "http://localhost:8080"),
    api_key=os.getenv(
        "LARKUP_API_KEY",
        "your-api-key",
    ),
)

indexed_ids = []
indexing_failures = 0

with LarkupClient(options) as client:
    try:
        health = client.health()
        print(f"Connected to {health.service or 'Larkup'}: {health.ok}")
        client.list_documents(page=1, limit=1)
        print("Authentication verified")

        documents = [
            Document(
                title="Python SDK demo",
                text="Larkup turns documents into a searchable RAG knowledge base.",
            ),
            Document(
                title="Python SDK progress",
                text="The SDK can index sequentially or in parallel and stream progress.",
            ),
        ]
        for progress in client.index_documents(
            documents,
            mode="parallel",
            concurrency=2,
            continue_on_error=True,
        ):
            if progress.id:
                indexed_ids.append(progress.id)
            indexing_failures = progress.failed
            if progress.error:
                print(progress.error)
            print(
                f"Indexing {progress.percent}% "
                f"({progress.succeeded} succeeded, {progress.failed} failed)"
            )

        if indexing_failures:
            raise RuntimeError("One or more documents failed to index.")

        results = client.query("How does SDK indexing work?", top_k=3)
        for hit in results.hits:
            print(f"{hit.score:.3f} {hit.title}: {hit.text}")

        summary = client.corpus_summary()
        print(f"Corpus: {summary.totalDocuments} indexed chunks")

        for event in client.chat("Summarize the SDK demo documents."):
            if event.type == "text-delta":
                print(event.text or "", end="", flush=True)
        print()
    finally:
        for document_id in indexed_ids:
            client.delete_document(document_id)
