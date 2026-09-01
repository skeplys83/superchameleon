import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { castsShadow } from "../levelScene.ts";

/**
 * The shape `GLTFLoader` actually produces: the **node** carries the Blender
 * object's name, and the light hanging inside it is named after the light's
 * *data-block*. Renaming a lamp in the outliner only touches the first, which
 * is why a test on the light's own name never fired and the hospital had no
 * shadows however many times it was exported.
 */
function asLoaded(nodeName: string, lightName: string) {
  const node = new THREE.Object3D();
  node.name = nodeName;
  const light = new THREE.PointLight();
  light.name = lightName;
  node.add(light);
  return light;
}

describe("which lamps opt into casting", () => {
  it("casts when the object was renamed, leaving the data-block alone", () => {
    expect(castsShadow(asLoaded("shadow_waiting_-3_15", "light_waiting.001"))).toBe(true);
  });

  it("casts when the data-block was renamed instead", () => {
    expect(castsShadow(asLoaded("light_waiting_-3_15", "shadow_waiting"))).toBe(true);
  });

  it("does not cast when neither name asks for it", () => {
    expect(castsShadow(asLoaded("light_waiting_-3_15", "light_waiting.001"))).toBe(false);
  });

  it("does not cast on a name that merely contains the word", () => {
    expect(castsShadow(asLoaded("lamp_no_shadow_here", "light_x"))).toBe(false);
  });

  it("survives a light with no parent at all", () => {
    const loose = new THREE.PointLight();
    loose.name = "shadow_loose";
    expect(castsShadow(loose)).toBe(true);
  });
});
