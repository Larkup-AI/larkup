import { ChatWorkspace } from "@/components/chat/chat-workspace";

export default function ChatPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col h-full">
        <ChatWorkspace />
      </div>
    </div>
  );
}
