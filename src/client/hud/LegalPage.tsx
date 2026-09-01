import { Footer } from "./Footer";

/**
 * The legal page. It replaces the start menu rather than navigating anywhere,
 * so the lobby keeps rendering behind it and the background is unchanged —
 * there is one page in this app and no router, and adding one for a page of
 * text would put the game's whole state behind a URL.
 */

/** Where the third-party work in this game came from. Keep this in step with
 *  what is actually shipped: every asset here is in `public/` or `levels/`. */
const CREDITS = [
  {
    what: "Dungeon kit — walls, floors, props",
    who: "KayKit Dungeon Pack by Kay Lousberg",
    where: "kaylousberg.itch.io/kaykit-dungeon-pack",
  },
  {
    what: "Additional 3D assets",
    who: "Kenney",
    where: "kenney.nl/assets/category:3D",
  },
  {
    what: "Sound effects",
    who: "Seth_Makes_Sounds, NHumphrey (Freesound)",
    where: "freesound.org",
  },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs uppercase tracking-widest text-neutral-400">{title}</h2>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-neutral-300">{children}</div>
    </section>
  );
}

export function LegalPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="absolute inset-0 bg-neutral-950/90 text-neutral-100 backdrop-blur-sm">
      <div className="flex h-full flex-col items-center overflow-y-auto py-10 pb-16">
        <div className="flex w-full max-w-2xl flex-col gap-8 px-6">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight">Legal</h1>
            <button
              onClick={onBack}
              className="rounded-md border border-neutral-700 px-4 py-2 text-sm text-neutral-200 transition hover:bg-neutral-800"
            >
              Back
            </button>
          </div>

          <Section title="What this is">
            <p>
              Super Chameleon is a multiplayer hide-and-seek game. It is provided as-is, with no
              warranty of any kind, and is not affiliated with any of the projects credited below.
            </p>
          </Section>

          <Section title="Data">
            <p>
              There are no accounts and nothing is stored. A player is a name typed into a box; it
              lives in the browser&rsquo;s own storage on the machine that typed it, and on the game
              server only for as long as that game is running. Nothing is written to a database,
              nothing is shared with a third party, and no analytics or tracking of any kind runs on
              this page.
            </p>
            <p>
              Games are hosted by whoever runs the server you connected to. Anything you type or
              paint is sent to that server and relayed to the other players in your game.
            </p>
          </Section>

          <Section title="Credits">
            <ul className="flex flex-col gap-2">
              {CREDITS.map((c) => (
                <li key={c.what} className="flex flex-col">
                  <span className="text-neutral-200">{c.what}</span>
                  <span className="text-neutral-400">
                    {c.who} — <span className="text-neutral-500">{c.where}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-neutral-400">
              Each is used under its own licence; those licences and their terms remain with their
              authors.
            </p>
          </Section>

          <Section title="Operator">
            <p className="text-neutral-400">
              Whoever runs this server is responsible for it. If you are that person, put your
              contact details and any notice your jurisdiction requires here — this section is a
              placeholder and is not legal advice.
            </p>
          </Section>
        </div>
      </div>

      <Footer />
    </div>
  );
}
