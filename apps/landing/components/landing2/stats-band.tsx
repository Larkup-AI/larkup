const stats = [
  { value: "14.2k", label: "GitHub stars" },
  { value: "40+", label: "Source connectors" },
  { value: "8M+", label: "Monthly queries served" },
  { value: "99.98%", label: "Index uptime" },
]

export function StatsBand() {
  return (
    <section className="border-y border-border/60 bg-secondary/30 py-12">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-4 sm:px-6 lg:grid-cols-4 lg:px-8">
        {stats.map((s) => (
          <div key={s.label} className="text-center">
            <div className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl">
              {s.value}
            </div>
            <div className="mt-1.5 text-sm text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
