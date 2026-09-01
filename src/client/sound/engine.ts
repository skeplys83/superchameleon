import * as THREE from "three";
import { DEFERRED_SOUNDS, EAGER_SOUNDS, SOUNDS, type SoundName } from "./catalogue";

/** How far a positional sound carries before it starts to fade. */
const REF_DISTANCE = 3.5;
/** Clamps the distance used in the falloff. Comfortably past the lobby's
 *  34 m width; the match maps are larger and rely on the rolloff instead. */
const MAX_DISTANCE = 60;
/** How sharply it falls once past `REF_DISTANCE`. Higher is a smaller-sounding room. */
const ROLLOFF = 1.25;
/** Ramp on either end of a loop. */
const LOOP_FADE = 0.05;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<SoundName, AudioBuffer>();
/** Looping sounds currently running, at most one per name. */
const loops = new Map<SoundName, { source: AudioBufferSourceNode; gain: GainNode }>();
/** One entry per sound that has been asked for, so no file is fetched twice. */
const loading = new Map<SoundName, Promise<void>>();
let unlockBound = false;
let warnedSuspended = false;
/** Suspended by the pause menu rather than by never having been unlocked. */
let pausedByGame = false;

/** Anything the browser counts as a user gesture. */
const GESTURES = ["pointerdown", "keydown", "touchstart"] as const;

/** Keep trying to unlock on any gesture until one works, then stop listening. */
function installUnlockListeners() {
  if (unlockBound || typeof window === "undefined") return;
  unlockBound = true;

  const stop = () => {
    for (const type of GESTURES) window.removeEventListener(type, attempt, true);
  };
  const attempt = () => {
    if (!ctx) return;
    if (ctx.state === "running") {
      stop();
      return;
    }
    void ctx.resume().then(() => {
      if (ctx?.state === "running") stop();
    });
  };

  for (const type of GESTURES) {
    window.addEventListener(type, attempt, { capture: true, passive: true });
  }
}

/** Sounds that turned out to be unplayable, so the warning is logged once. */
const broken = new Set<SoundName>();

const forward = new THREE.Vector3();
const up = new THREE.Vector3();

function ensureContext() {
  if (ctx) return ctx;
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  // Legal to create before any gesture — it simply starts suspended and makes no
  // sound until `unlockAudio` resumes it. Creating it early is what lets the
  // buffers decode before the first shot rather than during it.
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
  installUnlockListeners();
  return ctx;
}

/** Fetch and decode one sound, once. */
function load(context: AudioContext, name: SoundName) {
  const existing = loading.get(name);
  if (existing) return existing;

  const spec = SOUNDS[name];
  const started = (async () => {
    try {
      const res = await fetch(spec.url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const buffer = await context.decodeAudioData(await res.arrayBuffer());

      // A positional sound has to be mono or the panner has nothing to place.
      // Worth shouting about: the symptom is a sound that plays fine but never
      // seems to come from anywhere, which is easy to mistake for "3D audio is
      // just subtle".
      if (spec.positional && buffer.numberOfChannels !== 1) {
        console.warn(
          `sound: "${name}" is positional but has ${buffer.numberOfChannels} channels. ` +
            `It will not be spatialised. Re-export it as mono ` +
            `(ffmpeg -i ${spec.url.split("/").pop()} -ac 1 out.wav).`,
        );
      }
      buffers.set(name, buffer);
    } catch (e) {
      broken.add(name);
      console.warn(`sound: could not load "${name}" from ${spec.url}`, e);
    }
  })();

  loading.set(name, started);
  return started;
}

function loadAll(names: SoundName[]) {
  const context = ensureContext();
  if (!context) return Promise.resolve();
  return Promise.all(names.map((name) => load(context, name))).then(() => undefined);
}

/** Fetch and decode everything except the music. */
export function preloadSounds() {
  return loadAll(EAGER_SOUNDS);
}

/** Fetch and decode the music, which is 1.2 MB and is not wanted until a hunt begins. */
export function preloadMusic() {
  return loadAll(DEFERRED_SOUNDS);
}

/** Hand the audio context the user gesture it has been waiting for. */
export function unlockAudio() {
  const context = ensureContext();
  if (!context) return;
  preloadSounds();
  if (context.state === "suspended") void context.resume();
}

/** Pause silences everything rather than letting sounds run on behind the menu. */
export function setAudioSuspended(suspended: boolean) {
  // Recorded even without a context, so a sound arriving while paused is never
  // mistaken for the "we were never unlocked" fault the warning below is for.
  pausedByGame = suspended;
  if (!ctx) return;
  if (suspended && ctx.state === "running") void ctx.suspend();
  if (!suspended && ctx.state === "suspended") void ctx.resume();
}

/** Point the listener at wherever the camera is now. */
export function updateListener(camera: THREE.Camera) {
  if (!ctx) return;
  const l = ctx.listener;
  const p = camera.position;
  forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
  up.set(0, 1, 0).applyQuaternion(camera.quaternion);

  // The AudioParam form is current; the setters are deprecated but are all older
  // Safari understands.
  if (l.positionX) {
    l.positionX.value = p.x;
    l.positionY.value = p.y;
    l.positionZ.value = p.z;
    l.forwardX.value = forward.x;
    l.forwardY.value = forward.y;
    l.forwardZ.value = forward.z;
    l.upX.value = up.x;
    l.upY.value = up.y;
    l.upZ.value = up.z;
  } else {
    l.setPosition(p.x, p.y, p.z);
    l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
  }
}

export type PlayOptions = {
  /** World position. Omit for a sound with no location — your own footsteps, the
   *  whistle, anything already at the listener. */
  position?: readonly [number, number, number];
  /** Playback rate, which is also the pitch. 1 is the file as recorded. */
  rate?: number;
  /** Multiplied with the catalogue gain. */
  gain?: number;
};

/** Play one shot of a sound. */
export function playSound(name: SoundName, options: PlayOptions = {}) {
  const context = ctx;
  const out = master;
  const buffer = buffers.get(name);
  if (!context || !out || !buffer) return;

  // Still locked. Ask again — a sound being requested at all means the player is
  // doing something — drop this one, and say so once, because a silent game with
  // a silent cause is the worst thing this module can do.
  if (context.state !== "running") {
    const was = context.state;
    void context.resume();
    if (!warnedSuspended && !pausedByGame) {
      warnedSuspended = true;
      console.warn(
        `sound: "${name}" was dropped because the AudioContext was "${was}". ` +
          `It unlocks on the first click or keypress; if you see this repeatedly, ` +
          `unlockAudio() is not reaching the context that playSound() uses.`,
      );
    }
    return;
  }

  const spec = SOUNDS[name];
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = options.rate ?? 1;

  const gain = context.createGain();
  gain.gain.value = spec.gain * (options.gain ?? 1);

  let head: AudioNode = gain;
  let panner: PannerNode | null = null;
  if (options.position) {
    panner = context.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = REF_DISTANCE;
    panner.maxDistance = MAX_DISTANCE;
    panner.rolloffFactor = ROLLOFF;
    const [x, y, z] = options.position;
    // Set once: these sounds are all about a second long, so nothing moves far
    // enough during one for tracking to be worth a per-frame update.
    if (panner.positionX) {
      panner.positionX.value = x;
      panner.positionY.value = y;
      panner.positionZ.value = z;
    } else {
      panner.setPosition(x, y, z);
    }
    gain.connect(panner);
    head = panner;
  }

  head.connect(out);
  source.connect(gain);

  // Buffer sources are single-use, so everything here is torn down on end.
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
    panner?.disconnect();
  };
  source.start();
}

/** Start a sound looping, or do nothing if it already is. */
export function startLoop(
  name: SoundName,
  options: { gain?: number; rate?: number; once?: boolean } = {},
) {
  const context = ctx;
  const out = master;
  const buffer = buffers.get(name);
  if (!context || !out || !buffer || loops.has(name)) return;
  if (context.state !== "running") void context.resume();

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = options.once !== true;
  source.playbackRate.value = options.rate ?? 1;

  const gain = context.createGain();
  const target = SOUNDS[name].gain * (options.gain ?? 1);
  const now = context.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(target, now + LOOP_FADE);

  source.connect(gain);
  gain.connect(out);
  // A `once` source ends on its own, and the entry has to go with it or the
  // guard above would refuse to play it a second time next round.
  source.onended = () => {
    if (loops.get(name)?.source === source) loops.delete(name);
  };
  source.start();
  loops.set(name, { source, gain });
}

/** Fade a loop out and tear it down. Safe to call when it is not running. */
export function stopLoop(name: SoundName) {
  const live = loops.get(name);
  if (!live) return;
  loops.delete(name);

  const context = ctx;
  const done = () => {
    live.source.disconnect();
    live.gain.disconnect();
  };

  if (!context) {
    try {
      live.source.stop();
    } catch {
      // never started
    }
    done();
    return;
  }

  const now = context.currentTime;
  live.gain.gain.cancelScheduledValues(now);
  live.gain.gain.setValueAtTime(live.gain.gain.value, now);
  live.gain.gain.linearRampToValueAtTime(0, now + LOOP_FADE);
  live.source.onended = done;
  live.source.stop(now + LOOP_FADE);
}

/** Every loop, silenced. For teardown — a loop outlives the component that
 *  started it otherwise, because nothing else ever stops one. */
export function stopAllLoops() {
  for (const name of [...loops.keys()]) stopLoop(name);
}

