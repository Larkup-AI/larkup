import { ChatWorkspace } from '@/components/chat/chat-workspace';

export default async function ChatIdPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col h-full">
        <ChatWorkspace chatId={id} />
      </div>
    </div>
  );
}
