import { ArrowRight, Send, Terminal, Boxes, Database } from "lucide-react"

const GRID_ITEMS = [
  {
    id: "headline",
    className: "md:col-span-1 md:row-span-2",
    content: (
      <div className="flex flex-col justify-between h-full py-4">
        <div>
          <h2 className="text-3xl font-bold text-foreground leading-tight tracking-tight">
            Your pipeline, <br />delivered.
          </h2>
          <p className="mt-4 text-[15px] text-muted-foreground leading-relaxed">
            Security, speed, and AI included, so you can focus on your user.
          </p>
        </div>
      </div>
    ),
  },
  {
    id: "agents",
    className: "md:col-span-1",
    label: "Agents",
    description: "Deliver more value to users by executing complex workflows.",
    preview: (
      <div className="mt-6 border border-border rounded-xl bg-card shadow-sm p-4 mx-4">
        <div className="flex items-center gap-2 mb-3 text-xs font-medium text-muted-foreground">
          <Terminal className="size-3.5" /> Thinking...
        </div>
        <div className="border border-border rounded-lg bg-background p-2 flex items-center justify-between">
          <div className="w-1/2 h-1.5 bg-secondary rounded-full" />
          <div className="size-5 bg-caramel rounded flex items-center justify-center">
            <Send className="size-3 text-white" />
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "apps",
    className: "md:col-span-1",
    label: "AI Apps",
    description: "Enrich any product or feature with the latest models and tools.",
    preview: (
      <div className="mt-6 flex flex-wrap gap-2 px-4">
        <span className="px-3 py-1.5 border border-border bg-card rounded-md text-[11px] font-medium text-muted-foreground flex items-center gap-1.5 shadow-sm">
          <Boxes className="size-3" /> Fluid
        </span>
        <span className="px-3 py-1.5 border border-border bg-card rounded-md text-[11px] font-medium text-muted-foreground shadow-sm">
          AI SDK
        </span>
        <span className="px-3 py-1.5 border border-border bg-card rounded-md text-[11px] font-medium text-muted-foreground flex items-center gap-1.5 shadow-sm">
          AI GATEWAY
        </span>
        <span className="px-3 py-1.5 border border-border bg-card rounded-md text-[11px] font-medium text-muted-foreground shadow-sm">
          Workflow
        </span>
        <span className="px-3 py-1.5 border border-border bg-card rounded-md text-[11px] font-medium text-muted-foreground shadow-sm">
          Sandbox
        </span>
      </div>
    ),
  },
  {
    id: "webapps",
    className: "md:col-span-1",
    label: "Web Apps",
    description: "Ship beautiful interfaces that don't compromise speed or functionality.",
    preview: (
      <div className="mt-6 border border-border border-b-0 rounded-t-xl bg-card shadow-sm h-16 mx-4 relative overflow-hidden">
        <div className="absolute top-3 left-3 right-3 h-2 bg-secondary rounded-full" />
        <div className="absolute top-7 left-3 w-1/2 h-2 bg-secondary/50 rounded-full" />
      </div>
    ),
  },
  {
    id: "commerce",
    className: "md:col-span-1",
    label: "Vector Stores",
    description: "Increase conversion with fast, branded storefronts and search.",
    preview: (
      <div className="mt-6 border border-border rounded-xl bg-card shadow-sm p-4 mx-4 flex items-center gap-3">
        <div className="size-8 rounded bg-caramel/10 flex items-center justify-center shrink-0">
          <Database className="size-4 text-caramel" />
        </div>
        <div className="flex-1 space-y-2">
          <div className="w-full h-1.5 bg-secondary rounded-full" />
          <div className="w-2/3 h-1.5 bg-secondary rounded-full" />
        </div>
      </div>
    ),
  },
]

function GridCell({ item }: { item: typeof GRID_ITEMS[number] }) {
  if (item.id === "headline") {
    return (
      <div className={`${item.className} border-b md:border-r border-border px-8 py-8 flex flex-col justify-between bg-background`}>
        {item.content}
      </div>
    )
  }

  return (
    <div className={`${item.className} border-b md:border-r md:[&:nth-child(3n)]:border-r-0 border-border flex flex-col group hover:bg-secondary/20 transition-colors bg-background overflow-hidden relative min-h-[300px]`}>
      <div className="px-8 pt-8 pb-4">
        <h3 className="text-xl font-bold text-foreground">{item.label}</h3>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{(item as any).description}</p>
        
        <div className="mt-6">
          <button className="size-8 rounded-full border border-border flex items-center justify-center text-foreground hover:border-caramel hover:text-caramel transition-all shadow-sm bg-background">
            <ArrowRight className="size-4" />
          </button>
        </div>
      </div>
      
      {/* Decorative preview at bottom */}
      <div className="mt-auto pb-0">
        {(item as any).preview}
      </div>
    </div>
  )
}

export function BentoGrid() {
  return (
    <section className="border-b border-border bg-[#f8fafc] dark:bg-background/50 py-20" id="bento">
      <div className="mx-auto max-w-[1400px] px-6">
        <div className="border border-border rounded-xl bg-background overflow-hidden shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-3">
            {GRID_ITEMS.map((item) => (
              <GridCell key={item.id} item={item} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
