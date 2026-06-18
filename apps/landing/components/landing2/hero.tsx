"use client"

import { useState } from "react"
import { ArrowRight, Check, Copy, Star, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import {motion} from "framer-motion"
export function Hero() {
  const [copied, setCopied] = useState(false)

  function copyCmd() {
    navigator.clipboard?.writeText("npm i buddy-rag")
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <section className="relative overflow-hidden pt-32 pb-20 sm:pt-40 sm:pb-28">
      {/* Vercel-style modern lines and pluses — vertical lines start at first horizontal, not at top */}
      <div className="absolute inset-x-0 top-28 bottom-0 flex justify-center pointer-events-none">
        <div className="relative w-full max-w-5xl border-x border-border/30">
          {/* Horizontal lines */}
          <div className="absolute top-0 left-[-100vw] w-[300vw] h-px bg-border/30" />
          <div className="absolute bottom-16 left-[-100vw] w-[300vw] h-px bg-border/30" />

          {/* Plus icon at top-left intersection */}
          <Plus className="absolute top-0 left-0 w-8 h-8 text-muted-foreground/50 -translate-x-1/2 -translate-y-1/2" strokeWidth={1} />
        </div>
      </div>

      <div className="relative mx-auto flex max-w-4xl flex-col items-center px-4 text-center sm:px-6 lg:px-8">
         <motion.a
            href="https://github.com/BuddyHere-AI/buddy-rag"
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="mb-6 flex cursor-pointer items-center gap-2 rounded-full border 
             border-black/20 dark:border-white/10 
             bg-white/80 dark:bg-white/10 
             px-4 py-1.5 
             transition-colors hover:bg-[#F2F2F2] dark:hover:bg-white/20"
          >
            {/* <Sparkles className="h-4 w-4 text-green-600" /> */}
            <img src={"/icons/github.svg"} className="h-4 w-4 dark:text-white" />
            <span className="text-xs dark:text-white">
              Open Source RAG Framework
            </span>
          </motion.a>

        <h1 className="mt-0 text-balance text-4xl font-medium leading-[1.05] tracking-normal sm:text-6xl lg:text-6xl">
          The RAG framework for <span className="text-primary">grounded</span> AI
          in production
        </h1>

        <p className="mt-6 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
          Larkup RAG makes it easy to create fully functional RAG applications from ingestion to deployment. Connect any model to any source with a single typed pipeline ,fully observable, framework agnostic, and open source.
        </p>

        <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="w-full transition-all duration-300 hover:-translate-y-0.5 rounded-none sm:w-auto">
            <Link href="/contact">
              Get Started
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            variant={"outline"}
            size={"lg"}
            onClick={copyCmd}
            className="group cursor-pointer flex w-full rounded-none items-center justify-center gap-3 border border-border bg-card/80 dark:bg-card! dark:hover:bg-black/80! hover:bg-card px-4 py-2.5 font-mono text-sm transition-all duration-300 hover:-translate-y-0.5   sm:w-auto"
          >
           View Documentation
          </Button>
        </div>

       
      </div>
    </section>
  )
}
