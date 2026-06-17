"use client"

import { ArrowUpRight } from "lucide-react"

const PROVIDERS = [
  { name: "OpenAI" },
  { name: "Anthropic" },
  { name: "Google Gemini" },
  { name: "Mistral" },
  { name: "Pinecone" },
  { name: "LanceDB" },
]

function ProviderCell({ name }: { name: string }) {
  return (
    <div className="group relative flex h-full min-w-[200px] shrink-0 cursor-default items-center justify-center border-r border-border bg-background px-10 py-8 transition-colors hover:bg-secondary/20">
      <span className="text-xl font-bold tracking-tight text-foreground">
        {name}
      </span>
      <ArrowUpRight className="absolute right-2.5 bottom-2.5 size-3.5 text-caramel" />
    </div>
  )
}

export function ProviderSlider() {
  const doubled = [...PROVIDERS, ...PROVIDERS, ...PROVIDERS]

  return (
    <section className="border-b border-border bg-background">
      <div className="mx-auto max-w-[1400px]">
        <div className="flex flex-col items-stretch overflow-hidden border-x border-border md:flex-row">
          {/* Left fixed label cell */}
          <div className="relative z-20 flex shrink-0 flex-col justify-center border-b border-border bg-background px-8 py-8 shadow-[4px_0_12px_rgba(0,0,0,0.02)] md:w-[280px] md:border-r md:border-b-0">
            <p className="text-[15px] leading-relaxed text-foreground">
              Trusted by <br />
              <span className="font-semibold text-caramel">
                150,000+ companies
              </span>{" "}
              <br />
              of all sizes
            </p>
          </div>

          {/* Animated provider cells row */}
          <div className="flex flex-1 overflow-hidden bg-background">
            <div
              className="slider-track flex w-max items-stretch border-y-0"
              style={{
                display: "flex",
                alignItems: "stretch",
                width: "max-content",
                animation: "slider 20s linear infinite",
              }}
            >
              {doubled.map((provider, i) => (
                <ProviderCell
                  key={`${provider.name}-${i}`}
                  name={provider.name}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
