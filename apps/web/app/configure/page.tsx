import { PageHeader } from "@/components/page-header";
import { ConfigureForm } from "@/components/configure/configure-form";

export default function ConfigurePage() {
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow="Step 1 · Configure"
        title="Pipeline configuration"
        description="Choose your embedding model, indexing strategy, and vector store. Each store declares exactly the credentials it needs and the server you generate later ships only those dependencies."
      />
      <ConfigureForm />
    </div>
  );
}
