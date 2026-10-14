import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "./api.js";
import { toast } from "@posted/web-design-system";

export function useResource<T>(path: string | null, refreshInterval = 0) {
  const [value, setValue] = useState<T | null>(null);
  const [pending, setPending] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    if (path === null) {
      setValue(null);
      setPending(false);
      setFailed(false);
      return () => controller.abort();
    }
    const resourcePath = path;
    let loading = false;
    let outage = false;
    async function load() {
      if (loading || controller.signal.aborted) return;
      loading = true;
      try {
        const result = await api<T>(resourcePath, undefined, "GET", {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setValue(result);
          setFailed(false);
          outage = false;
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setFailed(true);
          if (!outage) toast.danger(errorText(error));
          outage = true;
        }
      } finally {
        loading = false;
        if (!controller.signal.aborted) setPending(false);
      }
    }
    setPending(true);
    void load();
    const timer = refreshInterval
      ? setInterval(() => {
          if (document.visibilityState === "visible") void load();
        }, refreshInterval)
      : undefined;
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [path, revision, refreshInterval]);
  return { value, pending, failed, refresh };
}
