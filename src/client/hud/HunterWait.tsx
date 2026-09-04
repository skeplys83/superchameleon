import { LABEL } from "./ui";

// Replaces LobbyPanel outright during hiding — the invite/roster/map picker
// answer questions the round has already settled.
export function HunterWait() {
  return (
    <div className="pointer-events-none w-[21rem] select-none rounded-2xl border-2 border-rose-500/40 bg-neutral-950/90 px-5 py-3 text-center">
      <div className={`text-rose-400 ${LABEL}`}>You are the hunter</div>
      <div className="mt-1 text-xl font-extrabold text-neutral-100">
        They are hiding
      </div>
      <p className="mt-1.5 text-xs font-medium leading-snug text-neutral-500">
        Wait here while they find a spot. You go in when the bell rings.
      </p>
    </div>
  );
}
