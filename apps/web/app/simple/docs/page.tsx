import { DataWorkspace } from "@/components/data/data-workspace"
import { SimpleIndexButton } from "@/components/simple/simple-index-button"

export default function SimpleDocsPage() {
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center justify-between px-6 pt-5 pb-4 md:px-8">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            Documents
          </h1>
          <p className="text-sm text-muted-foreground">
            Upload files, paste text, or scrape the web to build your knowledge base.
          </p>
        </div>
        <SimpleIndexButton />
      </div>
      <DataWorkspace />
    </div>
  )
}
