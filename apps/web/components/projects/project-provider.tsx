"use client"

import {
  createContext,
  useCallback,
  useContext,
  type ReactNode,
} from "react"
import useSWR, { mutate as globalMutate } from "swr"
/** A Project enriched with the runtime status shown in the shell. */
export interface WorkspaceProject {
  id: string
  name: string
  port: number
  createdAt: string
  updatedAt: string
  sourceCount: number
  indexed: boolean
  running: boolean
  endpoint: string
}

interface ProjectData {
  activeProjectId: string | null
  projects: WorkspaceProject[]
}

interface ProjectContextValue {
  isLoading: boolean
  projects: WorkspaceProject[]
  activeProject?: WorkspaceProject
  /** No Projects exist yet → run first-time onboarding. */
  isFirstRun: boolean
  refresh: () => void
  createProject: (name: string) => Promise<WorkspaceProject | undefined>
  activateProject: (id: string) => Promise<void>
  renameProject: (id: string, name: string) => Promise<void>
  deleteProject: (id: string) => Promise<void>
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const ProjectContext = createContext<ProjectContextValue | null>(null)

export function useProject() {
  const ctx = useContext(ProjectContext)
  if (!ctx) {
    throw new Error("useProject must be used within a ProjectProvider")
  }
  return ctx
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, mutate } = useSWR<ProjectData>(
    "/api/projects",
    fetcher,
    { revalidateOnFocus: false },
  )

  const projects = data?.projects ?? []
  const activeProject = projects.find((project) => project.id === data?.activeProjectId)
  const isFirstRun = !isLoading && projects.length === 0

  /** Revalidate every SWR key after switching the active Project. */
  const refreshAllStages = useCallback(async () => {
    await globalMutate(() => true)
  }, [])

  const createProject = useCallback(
    async (name: string) => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const json = await res.json()
      await mutate()
      await refreshAllStages()
      return json.project as WorkspaceProject | undefined
    },
    [mutate, refreshAllStages],
  )

  const activateProject = useCallback(
    async (id: string) => {
      await fetch("/api/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate", projectId: id }),
      })
      await mutate()
      await refreshAllStages()
    },
    [mutate, refreshAllStages],
  )

  const renameProject = useCallback(
    async (id: string, name: string) => {
      await fetch("/api/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename", projectId: id, name }),
      })
      await mutate()
    },
    [mutate],
  )

  const deleteProject = useCallback(
    async (id: string) => {
      await fetch(`/api/projects?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
      await mutate()
      await refreshAllStages()
    },
    [mutate, refreshAllStages],
  )

  const value: ProjectContextValue = {
    isLoading,
    projects,
    activeProject,
    isFirstRun,
    refresh: () => {
      void mutate()
    },
    createProject,
    activateProject,
    renameProject,
    deleteProject,
  }

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  )
}
