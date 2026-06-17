import { Navbar } from "@/components/landing/navbar"
import { Hero } from "@/components/landing/hero"
import { ProviderSlider } from "@/components/landing/provider-slider"
import { FeatureTabs } from "@/components/landing/feature-tabs"
import { BentoGrid } from "@/components/landing/bento-grid"
import { DeploySection } from "@/components/landing/deploy-section"
import { Footer } from "@/components/landing/footer"
import "./globals.css"

export function LandingPage1() {
  return (
    <main className="min-h-screen overflow-x-clip bg-background">
      <Navbar />
      <Hero />
      <ProviderSlider />
      <FeatureTabs />
      <BentoGrid />
      <DeploySection />
      <Footer />
    </main>
  )
}
