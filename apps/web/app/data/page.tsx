import { PageHeader } from "@/components/page-header";
import { DataWorkspace } from "@/components/data/data-workspace";
import { IndexActionDialog } from "@/components/index/index-action-dialog";

export default function DataPage() {
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow="Step 2 · Data"
        title="Load &amp; scrape data"
        description="Manage your corpus and ETL jobs. Load new data via web scraping, pasting, or uploading files."
        actions={<IndexActionDialog />}
      />
      <DataWorkspace />
    </div>
  );
}
