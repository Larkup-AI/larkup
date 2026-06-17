"use client"

import { useEffect, useState } from "react"

export function CookieConsent() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const seen =
      typeof window !== "undefined" &&
      window.localStorage.getItem("brew-cookie-consent")
    if (!seen) {
      const t = setTimeout(() => setVisible(true), 900)
      return () => clearTimeout(t)
    }
  }, [])

  function dismiss(value: "all" | "rejected" | "custom") {
    window.localStorage.setItem("brew-cookie-consent", value)
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-4 left-4 z-50 w-[calc(100%-2rem)] max-w-sm animate-float-soft sm:w-96">
      <div className="bg-noise overflow-hidden rounded-2xl border border-border bg-popover p-5 shadow-2xl">
        <div className="relative z-[1]">
          <h3 className="text-sm font-semibold text-foreground">
            We value your privacy
          </h3>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            This site uses cookies to improve your browsing experience, analyze
            site traffic, and show personalized content.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => dismiss("rejected")}
              className="rounded-lg border border-border bg-secondary/60 px-3.5 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              Reject all
            </button>
            <button
              onClick={() => dismiss("all")}
              className="rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Accept all
            </button>
            <button
              onClick={() => dismiss("custom")}
              className="ml-auto rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Customize
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
