import { PageHeader } from "@/components/page-header";
import { ChatWorkspace } from "@/components/chat/chat-workspace";

export default function ChatPage() {
  return (
    <div className="flex flex-col overflow-hidden" style={{ height: "100%" }}>
      <PageHeader
        eyebrow="Step 6 · Chat"
        title="Chat with your knowledge base"
        className="gap-0 pb-0"
      />
      <ChatWorkspace />
    </div>
  );
}
