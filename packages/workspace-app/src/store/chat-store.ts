import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ChatStore {
  selectedModel: string;
  setSelectedModel: (model: string) => void;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set) => ({
      selectedModel: '',
      setSelectedModel: (model) => set({ selectedModel: model }),
    }),
    {
      name: 'larkup-chat-store',
    },
  ),
);
