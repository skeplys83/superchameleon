import { playableMaps } from "@/shared/maps";
import { DEV } from "@/client/app/dev";
import { LABEL } from "./ui";

/**
 * The maps this build ships, shown rather than named.
 *
 * It lists what `playableMaps` allows, not `MAP_LIST`: the lobby map is the waiting
 * room everybody starts in rather than somewhere you go, and a map still being
 * built is offered by dev builds only.
 *
 * **It takes the left third of the menu**, against two thirds for the game
 * select. No plate and no border around it: the cards carry their own, and a
 * second frame around a column of framed cards is chrome for nothing.
 *
 * **It fills the height its parent gives it and scrolls inside**, so the menu
 * keeps the same shape however many maps exist — a list that grew the page would
 * push Create and Join off the bottom the moment a fourth map landed.
 *
 * The preview is a placeholder. When there are real images, drop an `<img>` in
 * place of the panel below and keep the `aspect-video` box: the card is sized
 * from that ratio, not from the image.
 */
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
              // Placeholder. Diagonal hatching rather than a flat grey, so it
              // reads as "no image yet" instead of as a broken one.
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
