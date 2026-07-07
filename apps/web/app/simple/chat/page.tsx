import { ChatWorkspace } from "@/components/chat/chat-workspace"

export default function SimpleChatPage() {
  return (
    <div className="flex flex-col overflow-hidden" style={{ height: "100%" }}>
      <div className="px-6 pt-5 pb-1 md:px-8">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          Chat
        </h1>
        <p className="text-sm text-muted-foreground">
          Ask questions and get AI-powered answers from your documents.
        </p>
      </div>
      <ChatWorkspace />
    </div>
  )
}
