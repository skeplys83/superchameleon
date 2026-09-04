import { useEffect, useState } from "react";
import { onChat, onLeftRoom, type ChatMessage } from "@/client/net";

// Subscribed here (not in ChatPanel) so lines landing before the panel mounts
// are not lost. Server keeps no chat — no replay.
export function useRoomChat(): ChatMessage[] {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => onChat(setMessages), []);

  useEffect(() => onLeftRoom(() => setMessages([])), []);

  return messages;
}
