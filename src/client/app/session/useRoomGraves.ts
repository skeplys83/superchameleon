import { useEffect, useState } from "react";
import { onGrave, onLeftRoom, type Grave } from "@/client/net";

export function useRoomGraves(): Grave[] {
  const [graves, setGraves] = useState<Grave[]>([]);

  // De-duplicated — a reconnection can replay a grave already held.
  useEffect(
    () =>
      onGrave((grave) =>
        setGraves((prev) => (prev.some((g) => g.id === grave.id) ? prev : [...prev, grave])),
      ),
    [],
  );

  useEffect(() => onLeftRoom(() => setGraves([])), []);

  return graves;
}
