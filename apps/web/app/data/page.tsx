import { PageHeader } from "@/components/page-header";
import { DataWorkspace } from "@/components/data/data-workspace";

export default function DataPage() {
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow="Step 2 · Data"
        title="Load &amp; scrape data"
        description="Manage your corpus and ETL jobs. Load new data via web scraping, pasting, or uploading files."
      />
      <DataWorkspace />
    </div>
  );
}
