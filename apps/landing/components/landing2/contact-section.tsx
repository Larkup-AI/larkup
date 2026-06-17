"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { Check, Loader2, Mail, ArrowRight, Zap, Shield, HeadphonesIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

const perks = [
  {
    icon: Zap,
    title: "Pipeline architecture review",
    desc: "We'll help you choose the right embedding model, vector store, and index strategy for your use case.",
  },
  {
    icon: Shield,
    title: "Migration assistance",
    desc: "Moving from another stack? We handle the transition from your existing retrieval setup.",
  },
  {
    icon: HeadphonesIcon,
    title: "Dedicated onboarding",
    desc: "A guided walkthrough of the full pipeline — from data ingestion to deployed server.",
  },
]

export function ContactSection() {
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle")

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus("loading")
    setTimeout(() => setStatus("done"), 1100)
  }

  return (
    <section id="contact" className="py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-2xl border border-border/60">
          <div className="grid lg:grid-cols-[1fr_1.1fr]">

            {/* ── Left: dark textured panel ── */}
            <div className="relative flex flex-col justify-between overflow-hidden rounded-l-2xl bg-foreground/[0.03] dark:bg-[#0e0e0e] p-10 sm:p-14">
              {/* SVG noise texture overlay */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-0"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E")`,
                  backgroundSize: "256px 256px",
                  mixBlendMode: "overlay",
                }}
              />

              {/* Subtle radial glow — bottom right */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute bottom-0 right-0 h-[380px] w-[380px] translate-x-1/4 translate-y-1/4 rounded-full opacity-30"
                style={{
                  background: "radial-gradient(circle, color-mix(in oklch, var(--primary) 10%, transparent), transparent 70%)",
                }}
              />

              {/* Content */}
              <div className="relative z-10">
                <motion.p
                  initial={{ opacity: 0, y: 8 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4 }}
                  className="text-xs font-semibold uppercase tracking-[0.22em] text-primary"
                >
                  Talk to us
                </motion.p>
                <motion.h2
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: 0.08 }}
                  className="mt-4 text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
                >
                  Let&apos;s get your RAG into production
                </motion.h2>
                <motion.p
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: 0.14 }}
                  className="mt-4 max-w-sm text-pretty text-base leading-relaxed text-muted-foreground"
                >
                  Tell us what you&apos;re building and we&apos;ll help you design a
                  retrieval architecture that scales. Open source forever — enterprise
                  support when you need it.
                </motion.p>

                {/* Perks */}
                <ul className="mt-10 space-y-6">
                  {perks.map((perk, i) => {
                    const Icon = perk.icon
                    return (
                      <motion.li
                        key={perk.title}
                        initial={{ opacity: 0, x: -12 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.45, delay: 0.2 + i * 0.1 }}
                        className="flex items-start gap-4"
                      >
                        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/50 bg-background/50 text-foreground">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-foreground">{perk.title}</p>
                          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{perk.desc}</p>
                        </div>
                      </motion.li>
                    )
                  })}
                </ul>
              </div>

              {/* Bottom email */}
              <motion.div
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.55 }}
                className="relative z-10 mt-14 flex items-center gap-2.5 text-sm text-muted-foreground"
              >
                <Mail className="h-4 w-4 text-primary" />
                hello@larkup.dev
              </motion.div>
            </div>

            {/* ── Right: form panel ── */}
            <div className="bg-card px-8 py-12 sm:px-12 sm:py-14">
              {status === "done" ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4 }}
                  className="flex h-full min-h-[480px] flex-col items-center justify-center text-center"
                >
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary ring-4 ring-primary/10">
                    <Check className="h-7 w-7" />
                  </div>
                  <h3 className="mt-6 text-2xl font-semibold">Message sent!</h3>
                  <p className="mt-3 max-w-xs text-base text-muted-foreground">
                    Thanks for reaching out — we&apos;ll get back to you within one
                    business day.
                  </p>
                </motion.div>
              ) : (
                <motion.form
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5 }}
                  onSubmit={onSubmit}
                  className="flex h-full flex-col gap-6"
                >
                  <div>
                    <h3 className="text-xl font-semibold tracking-tight">Get in touch</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Fill in the form and we&apos;ll be in touch within 24 hours.
                    </p>
                  </div>

                  {/* Name + Email row */}
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="name" className="text-sm font-medium">
                        Full name
                      </Label>
                      <Input
                        id="name"
                        name="name"
                        placeholder="Ada Lovelace"
                        required
                        className="h-12 rounded-xl text-base"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email" className="text-sm font-medium">
                        Work email
                      </Label>
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        placeholder="ada@company.com"
                        required
                        className="h-12 rounded-xl text-base"
                      />
                    </div>
                  </div>

                  {/* Company */}
                  <div className="space-y-2">
                    <Label htmlFor="company" className="text-sm font-medium">
                      Company <span className="text-muted-foreground font-normal">(optional)</span>
                    </Label>
                    <Input
                      id="company"
                      name="company"
                      placeholder="Acme Inc."
                      className="h-12 rounded-xl text-base"
                    />
                  </div>

                  {/* Message */}
                  <div className="flex-1 space-y-2">
                    <Label htmlFor="message" className="text-sm font-medium">
                      How can we help?
                    </Label>
                    <Textarea
                      id="message"
                      name="message"
                      rows={5}
                      placeholder="Tell us about your use case, team size, and what you're trying to build…"
                      required
                      className="resize-none rounded-xl text-base leading-relaxed"
                    />
                  </div>

                  {/* Submit */}
                  <Button
                    type="submit"
                    size="lg"
                    disabled={status === "loading"}
                    className="h-13 w-full rounded-xl text-base font-semibold transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg"
                  >
                    {status === "loading" ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Sending…
                      </>
                    ) : (
                      <>
                        Send message
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>

                  <p className="text-center text-xs text-muted-foreground">
                    We&apos;ll never share your details. No spam, ever.
                  </p>
                </motion.form>
              )}
            </div>

          </div>
        </div>
      </div>
    </section>
  )
}
