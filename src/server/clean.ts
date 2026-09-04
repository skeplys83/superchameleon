import {
  RegExpMatcher,
  TextCensor,
  englishDataset,
  englishRecommendedTransformers,
} from "obscenity";
import { randomName } from "../shared/names.ts";

// Server-only — a client filter is decoration (same trust model as movement).
const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

const censor = new TextCensor();

export const isFoul = (text: string) => matcher.hasMatch(text);

// Masked, not dropped — a silent vanish reads as a broken server.
export function cleanChat(text: string) {
  const matches = matcher.getAllMatches(text);
  return matches.length === 0 ? text : censor.applyTo(text, matches);
}

// Replaced, not masked or refused — "Ge****42" is worse than either
// alternative and refusing the join leaves nothing to fix.
export function cleanName(name: string) {
  return isFoul(name) || isFoul(collapsed(name)) ? randomName() : name;
}

// Second pass for names only — doing this to a sentence invents words across
// the gaps between real ones ("bass hole" → …).
const collapsed = (name: string) => name.replace(/[^\p{L}\p{N}]/gu, "");
