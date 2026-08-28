import { useEffect, useState } from "react";
import { onRoster, remotes } from "@/client/net";
import type { Role } from "@/shared/protocol";
import { LABEL } from "./ui";

/** A colour per side, and *only* a colour. */
const MARK: Record<Role, { tone: string }> = {
  hunter: { tone: "text-blue-300" },
  chameleon: { tone: "text-rose-300" },
};

function Row({
  name,
  role,
  showRole,
  you = false,
}: {
  name: string;
  role: Role;
  showRole: boolean;
  you?: boolean;
}) {
  const mark = MARK[role] ?? MARK.chameleon;
  return (
    <div className="flex items-baseline gap-1.5 text-neutral-200">
      <span>{name}</span>
      {showRole && <span className={`text-[10px] ${mark.tone}`}>{role}</span>}
      {/* The only green on the row. Your name and side are read the same way as
          everyone else's — the marker is what says which row is yours, and
          tinting the whole line made the side colour harder to compare. */}
      {you && <span className="text-[10px] text-emerald-400">(you)</span>}
    </div>
  );
}

export function PlayerList({
  name,
  role,
  showRoles,
}: {
  name: string;
  role: Role;
  /** Whether sides exist yet. */
  showRoles: boolean;
}) {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => onRoster(setIds), []);

  return (
    <div className="pointer-events-none absolute left-4 top-4 select-none rounded-xl bg-black/60 px-4 py-3 font-mono text-sm font-bold text-neutral-100 backdrop-blur">
      <div className={`mb-2 text-neutral-400 ${LABEL}`}>
        In this game · {ids.length + 1}
      </div>

      {/* Yours first, marked "(you)": in a list of near-identical rows, finding
          yourself should not need reading. */}
      <Row name={name} role={role} showRole={showRoles} you />

      {ids.map((id) => {
        const remote = remotes.get(id);
        if (!remote) return null;
        return <Row key={id} name={remote.name} role={remote.role} showRole={showRoles} />;
      })}
    </div>
  );
}
