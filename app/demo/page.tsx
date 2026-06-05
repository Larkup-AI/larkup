import { PageHeader } from "@/components/page-header"
import { DemoWorkspace } from "@/components/demo/demo-workspace"

export default function DemoPage() {
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow="Step 5 · Demo"
        title="Query your RAG pipeline"
        description="Send a test question and inspect the top-k documents your pipeline returns. If a generated server is running, the query hits it directly; otherwise it runs in-process against your store."
      />
      <DemoWorkspace />
    </div>
  )
}
