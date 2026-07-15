import { NextResponse } from "next/server"
import { getAllModels, getAllProviders, type GatewayModel } from "@larkup/core/models-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const type = url.searchParams.get("type") as GatewayModel["type"] | null
  const provider = url.searchParams.get("provider")

  try {
    let models = await getAllModels()
    if (type) models = models.filter((m) => m.type === type)
    if (provider) models = models.filter((m) => m.owned_by === provider)
    const providers = await getAllProviders(type || undefined)

    return NextResponse.json({ providers, models })
  } catch (error) {
    console.error("[api/models]", error)
    return NextResponse.json({ error: "Failed to fetch models", providers: [], models: [] }, { status: 500 })
  }
}
