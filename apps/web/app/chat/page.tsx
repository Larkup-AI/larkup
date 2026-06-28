import { PageHeader } from "@/components/page-header";
import { ChatWorkspace } from "@/components/chat/chat-workspace";

export default function ChatPage() {
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        eyebrow="Step 6 · Chat"
        title="Chat with your knowledge base"
      />
      <ChatWorkspace />
    </div>
  );
}
