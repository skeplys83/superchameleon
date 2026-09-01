import { useState } from "react";
import { sendChat, type ChatMessage } from "@/client/net";
import { MAX_CHAT_LENGTH } from "@/shared/protocol";
import { INPUT } from "./ui";

/**
 * The waiting room's chat: a box that is up for as long as the lobby is, and an
 * input that only exists while you are typing into it.
 *
 * **The bottom box never hides itself**, and it is the only part with a
 * background: closed it is the prompt naming the key, open it is the field. A
 * chat nobody can see is a chat nobody uses, and when the whole thing appeared
 * only once somebody had spoken, the first player in a lobby had no way to find
 * out it existed.
 *
 * **The lines above it float free** — no plate, no blur, no scrollbar, just text
 * over the world with a shadow under it. They are `pointer-events-none` and
 * clipped at the top rather than scrolled: the oldest slide out of sight, which
 * is what keeps a long conversation from growing up the screen.
 *
 * The lines are handed in rather than subscribed to here: the log is replayed
 * during the join, before this panel has mounted. `app/session/useRoomChat`
 * owns that, and says why.
 */
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
      {/* Bottom-aligned and clipped rather than scrolled: `justify-end` keeps
          the newest line against the input, and anything past `max-h` runs off
          the top and out of the way. */}
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
        // Clickable as well as documented: the cursor is already free in a
        // lobby, so a player who reaches for the mouse should not have to go
        // back to the keyboard to be let in.
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

/**
 * The one line you are typing. Mounted only while the box is open, which is why
 * the draft needs no clearing and the focus no effect.
 */
function ChatInput({ onClose }: { onClose: () => void }) {
  const [draft, setDraft] = useState("");

  const send = () => {
    const text = draft.trim();
    setDraft("");
    // The box stays up afterwards: a conversation should not cost one keypress
    // per line.
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
      // Every key is stopped here. The movement keys are bound on `window`
      // through drei's `KeyboardControls`, so without this typing "was" walks
      // you across the lobby. Esc is handled locally for the same reason:
      // stopping the event means the global handler in `usePauseControl` never
      // sees it.
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
