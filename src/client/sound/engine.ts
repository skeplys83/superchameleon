import * as THREE from "three";
import { DEFERRED_SOUNDS, EAGER_SOUNDS, SOUNDS, type SoundName } from "./catalogue";

const REF_DISTANCE = 3.5;
const MAX_DISTANCE = 60;
const ROLLOFF = 1.25;
const LOOP_FADE = 0.05;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<SoundName, AudioBuffer>();
const loops = new Map<SoundName, { source: AudioBufferSourceNode; gain: GainNode }>();
const loading = new Map<SoundName, Promise<void>>();
let unlockBound = false;
let warnedSuspended = false;
// Suspended by pause, distinct from never-unlocked.
let pausedByGame = false;

const GESTURES = ["pointerdown", "keydown", "touchstart"] as const;

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

const broken = new Set<SoundName>();

const forward = new THREE.Vector3();
const up = new THREE.Vector3();

function ensureContext() {
  if (ctx) return ctx;
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  // Legal to create before any gesture — it starts suspended.
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
  installUnlockListeners();
  return ctx;
}

function load(context: AudioContext, name: SoundName) {
  const existing = loading.get(name);
  if (existing) return existing;

  const spec = SOUNDS[name];
  const started = (async () => {
    try {
      const res = await fetch(spec.url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const buffer = await context.decodeAudioData(await res.arrayBuffer());

      // A positional sound must be mono — the panner has nothing to place otherwise.
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

export function preloadSounds() {
  return loadAll(EAGER_SOUNDS);
}

export function preloadMusic() {
  return loadAll(DEFERRED_SOUNDS);
}

export function unlockAudio() {
  const context = ensureContext();
  if (!context) return;
  preloadSounds();
  if (context.state === "suspended") void context.resume();
}

export function setAudioSuspended(suspended: boolean) {
  // Recorded even without a context so a sound arriving while paused is not
  // confused with the "never unlocked" fault below.
  pausedByGame = suspended;
  if (!ctx) return;
  if (suspended && ctx.state === "running") void ctx.suspend();
  if (!suspended && ctx.state === "suspended") void ctx.resume();
}

export function updateListener(camera: THREE.Camera) {
  if (!ctx) return;
  const l = ctx.listener;
  const p = camera.position;
  forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
  up.set(0, 1, 0).applyQuaternion(camera.quaternion);

  // AudioParam form is current; the setters are for older Safari.
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
  position?: readonly [number, number, number];
  rate?: number;
  gain?: number;
};

export function playSound(name: SoundName, options: PlayOptions = {}) {
  const context = ctx;
  const out = master;
  const buffer = buffers.get(name);
  if (!context || !out || !buffer) return;

  // Ask again but drop this one — logging once, since a silent game with no
  // cause is the worst thing this module can do.
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
    // Set once — these are ~1s sounds.
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

  source.onended = () => {
    source.disconnect();
    gain.disconnect();
    panner?.disconnect();
  };
  source.start();
}

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
  // A `once` source ends on its own — clear the entry or startLoop refuses next round.
  source.onended = () => {
    if (loops.get(name)?.source === source) loops.delete(name);
  };
  source.start();
  loops.set(name, { source, gain });
}

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

export function stopAllLoops() {
  for (const name of [...loops.keys()]) stopLoop(name);
}
