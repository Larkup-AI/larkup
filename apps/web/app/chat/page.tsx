import { PageHeader } from "@/components/page-header";
import { ChatWorkspace } from "@/components/chat/chat-workspace";

export default function ChatPage() {
  return (
    <div className="flex h-[calc(100vh-12rem)] min-h-[500px] flex-col">
      <PageHeader
        eyebrow="Step 6 · Chat"
        title="Chat with your knowledge base"
      />
      <ChatWorkspace />
    </div>
  );
}
