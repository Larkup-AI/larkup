import { PageHeader } from "@/components/page-header"
import { IndexWorkspace } from "@/components/index/index-workspace"

export default function IndexPage() {
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow="Step 3 · Index"
        title="Chunk, embed &amp; store"
        description="Split your corpus into chunks, embed them with your selected model, and write the vectors into your vector store. Progress streams live as the run works through the pipeline."
      />
      <IndexWorkspace />
    </div>
  )
}
