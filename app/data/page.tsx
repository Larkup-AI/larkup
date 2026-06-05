import { PageHeader } from "@/components/page-header"
import { DataWorkspace } from "@/components/data/data-workspace"

export default function DataPage() {
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow="Step 2 · Data"
        title="Load &amp; scrape data"
        description="Aggregate everything publicly available about a source. Search the web and crawl whole domains with the Firecrawl ETL — long jobs stream documents into your corpus as they run — or paste and upload text directly."
      />
      <DataWorkspace />
    </div>
  )
}
