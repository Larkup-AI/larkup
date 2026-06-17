import { SiteNavbar } from "@/components/landing2/site-navbar"
import { ContactSection } from "@/components/landing2/contact-section"
import { SiteFooter } from "@/components/landing2/site-footer"
import "@/components/landing/globals.css"

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-mesh-light">
      <SiteNavbar />
      <main className="relative z-[1]">
        <ContactSection />
      </main>
      <SiteFooter />
    </div>
  )
}
