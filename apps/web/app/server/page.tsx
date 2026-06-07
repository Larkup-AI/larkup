import { PageHeader } from "@/components/page-header"
import { ServerWorkspace } from "@/components/server/server-workspace"
import { DeployButton } from "@/components/server/deploy-button"

export default function ServerPage() {
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow="Step 4 · Server"
        title="Generate &amp; launch your RAG server"
        description="Emit a standalone, deployable RAG server tailored to your selected vector store — bundling only the dependencies it needs. Preview the files, download the project, or launch it locally."
        actions={<DeployButton />}
      />
      <ServerWorkspace />
    </div>
  )
}
