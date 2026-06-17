import { SiteNavbar } from "@/components/landing2/site-navbar"
import { ContactSection } from "@/components/landing2/contact-section"
import { SiteFooter } from "@/components/landing2/site-footer"
import "@/components/landing2/globals.css"

export default function ContactPage() {
  return (
    <div className="min-h-screen">
      <SiteNavbar />
      <main className="relative z-1 pt-20">
        <ContactSection />
      </main>
      <SiteFooter />
    </div>
  )
}
