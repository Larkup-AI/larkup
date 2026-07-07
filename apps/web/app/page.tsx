"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useWorkspace } from "@/components/workspace/workspace-provider"
import { Loader2 } from "lucide-react"

export default function Page() {
  const router = useRouter()
  const { mode, isLoading, isFirstRun } = useWorkspace()

  useEffect(() => {
    if (isLoading) return
    // If it's first run, the ClientLayoutWrapper will show the welcome screen
    if (isFirstRun || !mode) return

    if (mode === "simple") {
      router.replace("/simple/chat")
    } else {
      router.replace("/configure")
    }
  }, [mode, isLoading, isFirstRun, router])

  // Show a minimal loading state while determining the redirect
  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return null
}
