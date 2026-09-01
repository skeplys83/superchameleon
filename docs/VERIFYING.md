# Verifying changes

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Those four are the gates. Run them before calling anything done.

| gate        | what it actually proves                                                       |
| ----------- | ------------------------------------------------------------------------------- |
| `typecheck` | both projects compile — and, because `tsconfig.server.json` drops the `dom` lib, that the server half never reached for a browser global |
| `lint`      | the `server` / `client` / `shared` import boundaries, the `hud/` rule, and the React hook rules |
| `test`      | the server suite: rooms, phases, the draw, the pass rule, the clock            |
| `build`     | the client bundles                                                              |

## The server is tested; the client is not

`npm test` boots a real Colyseus server through `src/server/rooms.ts` and drives
real `colyseus.js` clients against it. **Write new server behaviour as a test
rather than as a paragraph in a doc** — there is a suite now, and prose cannot
fail CI. `src/server/CLAUDE.md` lists what each file covers.

Still uncovered, and still hand-checked: the round trip home from a finished
match, reconnection into a held seat, and the twenty-second drop window.

**Almost nothing on the client is tested.** It is three.js in a frame loop, and
the things that break are visual. Two suites are the exception, both in
`src/client/players/test/`: `inside.test.ts` on keeping a body in the room, and
`camera.test.ts` on where the follow camera may sit — pure geometry, no React
and no WebGL, so they run headlessly like any other. Anything shaped like that
belongs there rather than in a paragraph. What you can still do on your own:

- **Pure logic, headlessly.** Modules with no React or WebGL — the footstep
  stepper, stroke encoding, pose extents — import straight into Node, since it
  strips types. Add them to the vitest suite if they are worth keeping.
- **Do not drive the game in a browser. Ever.** Chrome automation is not part of
  this project's workflow — **the user runs the game and reports what they see
  and hear.** This is a standing instruction, not a default to weigh up: do not
  screenshot the game, do not click through menus, do not start a server on a
  spare port to "just check it renders".

  It also cannot do the job. The automated tab reports
  `visibilityState: "hidden"`, so Chrome refuses `requestPointerLock()` — a
  hunter's aim and trigger are out of reach — withholds the user activation an
  `AudioContext` needs, so nothing is ever audible, and the blur raises the
  pause menu over whatever you were trying to look at. What is left is a
  screenshot of a paused game with no sound, which tells you less than the
  build does and costs far more.

  A change to a panel, a layout, a colour or a phase transition ships to the
  user for checking, described plainly: what changed, where to look, and what
  you did **not** verify.
- **Audio levels, with ffmpeg.** `ffmpeg -i f.wav -af volumedetect -f null
  /dev/null` reports peak and mean. A sound nobody can hear is usually 20 dB
  down, not unwired.
- **SVG, with `qlmanage`, never ImageMagick.** `qlmanage -t -s 512 -o outdir
  file.svg` renders through WebKit and is what a browser will show.
  ImageMagick's built-in SVG renderer ignores gradients and will report a
  perfectly good icon as a black circle — it cost a wrong diagnosis once.

## Maps are covered by none of it

A `.glb` is data the build never looks at, so a level whose spawn point has moved
or whose collision no longer reaches the walls typechecks and builds perfectly.
`checkLevel` warns in the browser console at load, and a level can be parsed and
measured in Node without a browser — the recipe is in
[docs/notes/world.md](notes/world.md).

## What is not yours to sign off

Anything about feel — figure proportions, camera behaviour, gun placement,
whether a sound sits right in the mix, whether the arena plays well — **is the
user's call**. Say plainly what you checked and what you did not, rather than
implying it was all confirmed.
