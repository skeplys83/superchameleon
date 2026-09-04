import { playableMaps } from "@/shared/maps";
import { DEV } from "@/client/app/dev";
import { LABEL } from "./ui";

// Shows playableMaps (skips the lobby map and any DEV_ONLY). Fills its
// parent's height and scrolls inside.
export function MapList() {
  const maps = playableMaps(DEV);

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex shrink-0 items-baseline gap-2">
        <span className={`text-neutral-300 ${LABEL}`}>Maps</span>
        <span className="text-sm font-bold text-neutral-600">{maps.length}</span>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {maps.map((m) => (
          <article
            key={m.id}
            className="overflow-hidden rounded-3xl border-2 border-neutral-700 bg-neutral-900"
          >
            <div
              // Diagonal hatching placeholder — reads as "no image yet".
              className="flex aspect-video items-center justify-center border-b border-neutral-800 bg-[repeating-linear-gradient(45deg,rgb(23,23,23)_0px,rgb(23,23,23)_10px,rgb(31,31,31)_10px,rgb(31,31,31)_20px)]"
            >
              <span className={`text-neutral-600 ${LABEL}`}>preview</span>
            </div>

            <div className="px-4 py-3">
              <div className="text-xl font-extrabold text-neutral-100">{m.name}</div>
              <p className="mt-1.5 text-sm font-medium leading-relaxed text-neutral-400">
                {m.blurb}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
