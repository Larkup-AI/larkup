import { SiteNavbar } from "@/components/landing2/site-navbar"
import { Hero } from "@/components/landing2/hero"
import { ProviderMarquee } from "@/components/landing2/provider-marquee"
import { BentoGrid } from "@/components/landing2/bento-grid"
import { FeatureTabs } from "@/components/landing2/feature-tabs"
import { StatsBand } from "@/components/landing2/stats-band"
import { ContactSection } from "@/components/landing2/contact-section"
import { SiteFooter } from "@/components/landing2/site-footer"
import "./globals.css"

export function LandingPage2() {
  return (
    <div className="min-h-screen bg-transparent">
      <SiteNavbar />
      <main className="relative z-1">
        <Hero />
        <ProviderMarquee />
        <BentoGrid />
        <FeatureTabs />
        <StatsBand />
      </main>
      <SiteFooter />
    </div>
  )
}
