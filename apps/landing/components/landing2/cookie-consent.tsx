"use client"

import { useEffect, useState } from "react"
import { Lock, Settings, BarChart2, Megaphone } from "lucide-react"

interface CookiePreferences {
  strictlyNecessary: boolean // Always true
  functional: boolean
  analytics: boolean
  marketing: boolean
}

export function CookieConsent() {
  const [visible, setVisible] = useState(false)
  const [showCustomize, setShowCustomize] = useState(false)
  
  const [preferences, setPreferences] = useState<CookiePreferences>({
    strictlyNecessary: true,
    functional: false,
    analytics: false,
    marketing: false,
  })

  useEffect(() => {
    const isDev = process.env.NODE_ENV === "development"
    const seen =
      !isDev &&
      typeof window !== "undefined" &&
      window.localStorage.getItem("brew-cookie-consent")
      
    if (!seen) {
      const t = setTimeout(() => setVisible(true), 900)
      return () => clearTimeout(t)
    } else {
      // If already seen, we could load preferences here if we stored them as JSON
      try {
        const savedPrefs = window.localStorage.getItem("brew-cookie-preferences")
        if (savedPrefs) {
          setPreferences(JSON.parse(savedPrefs))
        }
      } catch (e) {}
    }
  }, [])

  function saveAndDismiss(prefs: CookiePreferences, type: "all" | "rejected" | "custom") {
    if (process.env.NODE_ENV !== "development") {
      window.localStorage.setItem("brew-cookie-consent", type)
      window.localStorage.setItem("brew-cookie-preferences", JSON.stringify(prefs))
    }
    setPreferences(prefs)
    setVisible(false)
    setShowCustomize(false)
  }

  function handleAcceptAll() {
    saveAndDismiss({
      strictlyNecessary: true,
      functional: true,
      analytics: true,
      marketing: true
    }, "all")
  }

  function handleRejectAll() {
    saveAndDismiss({
      strictlyNecessary: true,
      functional: false,
      analytics: false,
      marketing: false
    }, "rejected")
  }

  function handleSaveSettings() {
    saveAndDismiss(preferences, "custom")
  }

  if (!visible) return null

  return (
    <>
      {/* Mini Popup */}
      {!showCustomize && (
        <div className="fixed bottom-4 right-4 z-50 w-[calc(100%-2rem)] max-w-sm animate-float-soft sm:w-96">
          <div className="bg-noise overflow-hidden rounded-2xl border border-border bg-background p-6 shadow-2xl">
            <div className="relative z-[1]">
              <h3 className="text-base font-semibold text-foreground">
                We value your privacy
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
                This site uses cookies to improve your browsing experience, analyze
                site traffic, and show personalized content.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-2">
                <button
                  onClick={handleRejectAll}
                  className="flex-1 rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted dark:bg-[#2A2A2A] dark:border-[#3A3A3A] dark:hover:bg-[#333333]"
                >
                  Reject All
                </button>
                <button
                  onClick={handleAcceptAll}
                  className="flex-1 rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 dark:bg-white dark:text-black"
                >
                  Accept All
                </button>
                <button
                  onClick={() => setShowCustomize(true)}
                  className="flex-1 rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted dark:bg-[#2A2A2A] dark:border-[#3A3A3A] dark:hover:bg-[#333333]"
                >
                  Customize
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Customize Modal */}
      {showCustomize && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm sm:p-6">
          <div className="bg-noise relative w-full max-w-2xl overflow-hidden rounded-3xl border border-border bg-background p-6 shadow-2xl sm:p-8">
            <div className="relative z-[1]">
              <div className="mb-6">
                <h2 className="text-2xl font-semibold text-foreground">Cookie Settings</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Choose which cookies you allow. You can change this anytime.
                </p>
              </div>

              <div className="space-y-4">
                {/* Strictly Necessary */}
                <div className="flex items-start gap-4 rounded-2xl border border-border bg-muted/20 p-4 transition-colors hover:bg-muted/40 dark:bg-[#1A1A1A] dark:border-[#2A2A2A]">
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground">
                    <Lock className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-medium text-foreground">Strictly Necessary</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Essential for the website to function. Cannot be disabled.</p>
                  </div>
                  <div className="ml-4 mt-1 flex shrink-0 items-center">
                    <button
                      type="button"
                      role="switch"
                      aria-checked="true"
                      disabled
                      className="relative inline-flex h-6 w-11 items-center rounded-full bg-primary/50 opacity-70 cursor-not-allowed"
                    >
                      <span className="inline-block h-4 w-4 translate-x-6 transform rounded-full bg-white transition-transform" />
                    </button>
                  </div>
                </div>

                {/* Functional */}
                <div className="flex items-start gap-4 rounded-2xl border border-border bg-muted/20 p-4 transition-colors hover:bg-muted/40 dark:bg-[#1A1A1A] dark:border-[#2A2A2A]">
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground">
                    <Settings className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-medium text-foreground">Functional</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Remember your preferences like language and theme.</p>
                  </div>
                  <div className="ml-4 mt-1 flex shrink-0 items-center">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={preferences.functional}
                      onClick={() => setPreferences(p => ({ ...p, functional: !p.functional }))}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        preferences.functional ? "bg-primary" : "bg-muted dark:bg-[#333]"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          preferences.functional ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Analytics */}
                <div className="flex items-start gap-4 rounded-2xl border border-border bg-muted/20 p-4 transition-colors hover:bg-muted/40 dark:bg-[#1A1A1A] dark:border-[#2A2A2A]">
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground">
                    <BarChart2 className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-medium text-foreground">Analytics</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Help us understand how visitors use the website.</p>
                  </div>
                  <div className="ml-4 mt-1 flex shrink-0 items-center">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={preferences.analytics}
                      onClick={() => setPreferences(p => ({ ...p, analytics: !p.analytics }))}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        preferences.analytics ? "bg-primary" : "bg-muted dark:bg-[#333]"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          preferences.analytics ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Marketing */}
                <div className="flex items-start gap-4 rounded-2xl border border-border bg-muted/20 p-4 transition-colors hover:bg-muted/40 dark:bg-[#1A1A1A] dark:border-[#2A2A2A]">
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground">
                    <Megaphone className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-medium text-foreground">Marketing</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Used to deliver relevant ads and track campaigns.</p>
                  </div>
                  <div className="ml-4 mt-1 flex shrink-0 items-center">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={preferences.marketing}
                      onClick={() => setPreferences(p => ({ ...p, marketing: !p.marketing }))}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        preferences.marketing ? "bg-primary" : "bg-muted dark:bg-[#333]"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          preferences.marketing ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
                <div className="flex gap-3">
                  <button
                    onClick={handleRejectAll}
                    className="rounded-xl border border-border bg-muted/50 px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted dark:bg-[#2A2A2A] dark:border-[#3A3A3A] dark:hover:bg-[#333333]"
                  >
                    Reject All
                  </button>
                  <button
                    onClick={handleAcceptAll}
                    className="rounded-xl border border-border bg-muted/50 px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted dark:bg-[#2A2A2A] dark:border-[#3A3A3A] dark:hover:bg-[#333333]"
                  >
                    Accept All
                  </button>
                </div>
                <button
                  onClick={handleSaveSettings}
                  className="rounded-xl bg-foreground px-6 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 dark:bg-white dark:text-black"
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
