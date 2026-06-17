import { ArrowRight, BookOpen, Plus } from "lucide-react"

export function Hero() {
  return (
    <section
      className="relative flex min-h-[90vh] flex-col items-center justify-center overflow-hidden border-b border-border"
      id="hero"
    >
      {/* ── Background Grid & Decorations ── */}
      <div className="pointer-events-none absolute inset-0 top-[80px] flex justify-center">
        {/* Full width grid container */}
        <div className="relative h-full w-full">
          {/* Glowing center behind text to ensure readability */}
          <div className="absolute top-[30%] left-1/2 h-[400px] w-[800px] -translate-x-1/2 -translate-y-1/2 bg-background blur-[100px]" />

          {/* Grid Pattern */}
          <svg
            className="absolute inset-0 h-full w-full text-foreground/8 dark:text-foreground/15"
            xmlns="http://www.w3.org/2000/svg"
            style={{
              maskImage:
                "radial-gradient(ellipse 60% 60% at 50% 30%, transparent 15%, black 60%)",
              WebkitMaskImage:
                "radial-gradient(ellipse 60% 60% at 50% 30%, transparent 15%, black 60%)",
            }}
          >
            <defs>
              <pattern
                id="hero-grid"
                width="80"
                height="80"
                patternUnits="userSpaceOnUse"
                x="50%"
              >
                <path
                  d="M 80 0 L 0 0 0 80"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#hero-grid)" />
          </svg>

          {/* Fade out to the bottom */}
          <div className="absolute inset-0 bg-linear-to-b from-transparent via-background/90 to-background" />

          {/* ── Scattered Elements ── */}
          <div className="absolute inset-0 overflow-hidden">
            {/* Top Left Plus */}
            <Plus
              className="absolute top-[72px] left-[calc(50%-328px)] h-4 w-4 text-caramel"
              strokeWidth={2}
            />
            {/* Top Right Plus */}
            <Plus
              className="absolute top-[152px] left-[calc(50%+232px)] h-4 w-4 text-caramel"
              strokeWidth={2}
            />
            {/* Bottom Left Plus */}
            <Plus
              className="absolute top-[472px] left-[calc(50%-408px)] h-4 w-4 text-caramel"
              strokeWidth={2}
            />
            {/* Bottom Right Plus */}
            <Plus
              className="absolute top-[392px] left-[calc(50%+392px)] h-4 w-4 text-caramel"
              strokeWidth={2}
            />

            {/* Code Snippets */}
            <div className="absolute top-[90px] left-[calc(50%-470px)] font-mono text-[10px] font-medium text-muted-foreground/40">
              [ 200 OK ]
            </div>
            <div className="absolute top-[170px] left-[calc(50%+330px)] font-mono text-[10px] font-medium text-muted-foreground/40">
              [ RAG_API ]
            </div>
            <div className="absolute top-[410px] left-[calc(50%-550px)] font-mono text-[10px] font-medium text-muted-foreground/40">
              [ .JSON ]
            </div>

            {/* Mini squares */}
            <div className="absolute top-[90px] left-[calc(50%-230px)] size-2.5 bg-muted-foreground/20" />
            <div className="absolute top-[250px] left-[calc(50%+410px)] size-2 bg-muted-foreground/20" />

            {/* Dot matrices */}
            <div className="absolute top-[180px] left-[calc(50%-460px)] grid grid-cols-3 gap-1.5 opacity-20">
              {[...Array(9)].map((_, i) => (
                <div key={i} className="size-1 bg-foreground" />
              ))}
            </div>
            <div className="absolute top-[100px] left-[calc(50%+340px)] grid grid-cols-3 gap-1.5 opacity-20">
              {[...Array(9)].map((_, i) => (
                <div key={i} className="size-1 rounded-full bg-foreground" />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-center px-6 pt-[80px] pb-24 text-center">
        {/* Pill badge */}
        <div className="mb-8 inline-flex cursor-default items-center gap-2 rounded-full border border-border bg-background px-4 py-1.5 shadow-sm transition-colors hover:bg-secondary/30">
          <img src={"/github.svg"} className="size-3.5 text-muted-foreground" />
          <span className="text-[13px] font-medium text-foreground">
            Open Source RAG Framework
          </span>
        </div>

        {/* Heading */}
        <h1 className="mb-5 text-4xl leading-[1.1] font-bold tracking-tight text-foreground sm:text-5xl md:text-[56px]">
          Build Intelligent <br className="hidden sm:block" />
          <span className="text-caramel">AI Agents</span> Your Way
        </h1>

        {/* Sub */}
        <p className="mx-auto mb-10 max-w-[640px] text-base leading-relaxed text-muted-foreground md:text-[17px]">
          Connect to 10+ LLM providers, 8+ vector stores, build custom AI tools,
          and design powerful agents with an OpenAI-compatible API. All in one
          unified framework.
        </p>

        {/* Buttons */}
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <a
            href="#"
            className="inline-flex min-w-[140px] items-center justify-center rounded-md bg-[#0a0f1a] px-6 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-[#0a0f1a]"
          >
            Get Started
          </a>
          <a
            href="#"
            className="inline-flex min-w-[140px] items-center justify-center rounded-md border border-border bg-transparent px-6 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary/50"
          >
            <BookOpen className="mr-2 size-4 opacity-70" />
            View Documentation
          </a>
        </div>
      </div>
    </section>
  )
}
