// Fallback names — both halves read them. Client offers one in the name box;
// server hands one out when clean.ts refuses a name.
export const NAMES = [
  "Gecko",
  "Iguana",
  "Skink",
  "Anole",
  "Monitor",
  "Basilisk",
  "Agama",
  "Tegu",
  "Draco",
  "Newt",
  "Salamander",
  "Axolotl",
  "Komodo",
  "Uromastyx",
  "Tuatara",
  "Chuckwalla",
  "Gila",
  "Bearded",
  "Frilled",
  "Leafmimic",
];

export function randomName() {
  const name = NAMES[Math.floor(Math.random() * NAMES.length)];
  return `${name}${Math.floor(Math.random() * 90) + 10}`;
}
