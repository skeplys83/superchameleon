import { useState } from "react";
import { sendChat, type ChatMessage } from "@/client/net";
import { MAX_CHAT_LENGTH } from "@/shared/protocol";
import { INPUT } from "./ui";

// Bottom box never hides — closed it names the key, open it is the field.
// Lines above float free (no plate, no scroll), clipped at the top.
// Messages come in as props — replay lands during join, before this mounts.
export function ChatPanel({
  open,
  onOpenChange,
  messages,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messages: ChatMessage[];
}) {
  return (
    <div className="absolute bottom-4 left-4 z-10 flex w-80 select-none flex-col gap-1.5">
      {/* justify-end + max-h → oldest lines slide off the top. */}
      {messages.length > 0 && (
        <div className="pointer-events-none flex max-h-48 flex-col justify-end overflow-hidden font-mono text-xs font-bold leading-relaxed [text-shadow:0_1px_3px_rgb(0_0_0/0.95)]">
          {messages.map((m) => (
            <div key={m.id} className="break-words">
              <span className="text-emerald-300">{m.name}</span>
              <span className="text-neutral-400"> · </span>
              <span className="text-neutral-100">{m.text}</span>
            </div>
          ))}
        </div>
      )}
      {open ? (
        <ChatInput onClose={() => onOpenChange(false)} />
      ) : (
        <button
          onClick={() => onOpenChange(true)}
          className="pointer-events-auto flex items-center gap-2 rounded-xl bg-black/60 px-3 py-2 text-left font-mono text-xs font-bold text-neutral-400 backdrop-blur transition hover:bg-black/80 hover:text-neutral-200"
        >
          <span className="rounded-md border-2 border-neutral-600 px-1.5 py-0.5 text-xs text-neutral-200">
            T
          </span>
          to chat
        </button>
      )}
    </div>
  );
}

function ChatInput({ onClose }: { onClose: () => void }) {
  const [draft, setDraft] = useState("");

  const send = () => {
    const text = draft.trim();
    setDraft("");
    // Box stays open — a conversation is not one keypress per line.
    if (text) sendChat(text);
  };

  return (
    <input
      autoFocus
      value={draft}
      maxLength={MAX_CHAT_LENGTH}
      placeholder="Say something…"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={onClose}
      // stopPropagation on every key — drei's KeyboardControls is on `window`,
      // so without this typing "was" walks you across the lobby. Esc is
      // handled locally for the same reason.
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          send();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
      className={`pointer-events-auto w-full border-emerald-600/60 bg-black/80 font-mono text-neutral-100 backdrop-blur placeholder:text-neutral-600 focus:border-emerald-400 ${INPUT}`}
    />
  );
}
