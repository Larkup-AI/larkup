import { DataWorkspace } from "@/components/data/data-workspace"

export default function SimpleDocsPage() {
  return (
    <div className="flex min-h-full flex-col">
      <div className="px-6 pt-5 pb-1 md:px-8">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          Documents
        </h1>
        <p className="text-sm text-muted-foreground">
          Upload files, paste text, or scrape the web to build your knowledge base.
        </p>
      </div>
      <DataWorkspace />
    </div>
  )
}
