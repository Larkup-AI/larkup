"use client"

import {
  createContext,
  useCallback,
  useContext,
  type ReactNode,
} from "react"
import useSWR, { mutate as globalMutate } from "swr"
import type { WorkspaceMode } from "@larkup/core/workspace"

/** A workspace server enriched with the per-server status the UI shows. */
export interface WorkspaceServer {
  id: string
  name: string
  port: number
  createdAt: string
  updatedAt: string
  docCount: number
  indexed: boolean
  running: boolean
  endpoint: string
}

interface WorkspaceData {
  username: string | null
  activeServerId: string | null
  servers: WorkspaceServer[]
  mode: WorkspaceMode | null
}

interface WorkspaceContextValue {
  isLoading: boolean
  username: string | null
  servers: WorkspaceServer[]
  activeServer?: WorkspaceServer
  /** No servers exist yet → run first-time onboarding. */
  isFirstRun: boolean
  /** User-selected mode: tech, simple, or null (not yet chosen). */
  mode: WorkspaceMode | null
  refresh: () => void
  createServer: (name: string) => Promise<WorkspaceServer | undefined>
  activateServer: (id: string) => Promise<void>
  renameServer: (id: string, name: string) => Promise<void>
  deleteServer: (id: string) => Promise<void>
  setUsername: (name: string) => Promise<void>
  setMode: (mode: WorkspaceMode) => Promise<void>
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider")
  }
  return ctx
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, mutate } = useSWR<WorkspaceData>(
    "/api/servers",
    fetcher,
    { revalidateOnFocus: false },
  )

  const servers = data?.servers ?? []
  const activeServer = servers.find((s) => s.id === data?.activeServerId)
  const isFirstRun = !isLoading && servers.length === 0

  /** Revalidate every SWR key — used after switching the active server so all
   * stage pages reflect the newly selected server. */
  const refreshAllStages = useCallback(async () => {
    await globalMutate(() => true)
  }, [])

  const createServer = useCallback(
    async (name: string) => {
      const res = await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const json = await res.json()
      await mutate()
      await refreshAllStages()
      return json.server as WorkspaceServer | undefined
    },
    [mutate, refreshAllStages],
  )

  const activateServer = useCallback(
    async (id: string) => {
      await fetch("/api/servers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate", serverId: id }),
      })
      await mutate()
      await refreshAllStages()
    },
    [mutate, refreshAllStages],
  )

  const renameServer = useCallback(
    async (id: string, name: string) => {
      await fetch("/api/servers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename", serverId: id, name }),
      })
      await mutate()
    },
    [mutate],
  )

  const deleteServer = useCallback(
    async (id: string) => {
      await fetch(`/api/servers?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
      await mutate()
      await refreshAllStages()
    },
    [mutate, refreshAllStages],
  )

  const setUsername = useCallback(
    async (name: string) => {
      await fetch("/api/servers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setUsername", username: name }),
      })
      await mutate()
    },
    [mutate],
  )

  const setModeAction = useCallback(
    async (mode: WorkspaceMode) => {
      await fetch("/api/servers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setMode", mode }),
      })
      await mutate()
    },
    [mutate],
  )

  const value: WorkspaceContextValue = {
    isLoading,
    username: data?.username ?? null,
    servers,
    activeServer,
    isFirstRun,
    mode: data?.mode ?? null,
    refresh: () => {
      void mutate()
    },
    createServer,
    activateServer,
    renameServer,
    deleteServer,
    setUsername,
    setMode: setModeAction,
  }

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}
