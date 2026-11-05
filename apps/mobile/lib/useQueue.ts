import { useEffect, useState } from "react";
import type { QueueItem } from "./queue";
import { getRuntime, onQueueChange } from "./runtime";

/** Live list of queued captures (re-read on every queue change). */
export function useQueueItems(): QueueItem[] {
  const [items, setItems] = useState<QueueItem[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      getRuntime()
        .then((rt) => alive && setItems(rt.queue.list()))
        .catch(() => undefined);
    load();
    const off = onQueueChange(load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return items;
}
