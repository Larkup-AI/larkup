"use client"

import { ArrowRight } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { motion } from "framer-motion"

export function CtaSection() {
  return (
    <section className="py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55, ease: "easeOut" }}
          className="flex flex-col items-center text-center"
        >
          {/* Headline */}
          <h2 className="max-w-2xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Ready to build your RAG app?
          </h2>

          {/* Sub-copy */}
          <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            Whether you&apos;re wiring up a custom knowledge-base bot, an
            agentic research assistant, or a fully observable production
            pipeline — Larkup gets you there, fast.
          </p>

          {/* CTA button */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.15, ease: "easeOut" }}
            className="mt-10"
          >
            <Button
              asChild
              size="lg"
              className="rounded-none h-13 px-8 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg"
            >
              <Link href="/contact">
                Get started free
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
