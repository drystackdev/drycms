import { useEffect, useState } from "preact/hooks";

const DEFAULT_DELAY_MS = 180;

/**
 * Delays a loading indicator so a fast request does not flash a transient
 * "Loading" state between two already-nearby renders. The request itself is
 * never delayed; only the indicator is.
 */
export function useDelayedLoading(loading: boolean, delayMs = DEFAULT_DELAY_MS): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!loading) {
      setVisible(false);
      return;
    }

    const timer = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [loading, delayMs]);

  return visible;
}
