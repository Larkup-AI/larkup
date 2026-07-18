import { DataWorkspace } from "@/components/data/data-workspace";

export default function DataPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-6 pb-2 md:px-8">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Data
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload files, scrape the web, or manage your knowledge base.
        </p>
      </div>
      <div className="flex-1 min-h-0 pb-8">
        <DataWorkspace />
      </div>
    </div>
  );
}
