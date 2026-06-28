import { PageHeader } from "@/components/page-header"
import { ChatWorkspace } from "@/components/chat/chat-workspace"

export default function ChatPage() {
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow="Step 6 · Chat"
        title="Chat with your knowledge base"
        description="Ask questions in natural language and get AI-powered answers grounded in your indexed documents. The assistant retrieves relevant context from your RAG pipeline automatically."
      />
      <ChatWorkspace />
    </div>
  )
}
