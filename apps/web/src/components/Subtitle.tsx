import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { boot, SUBTITLE } from "../lib/motion";

export function Subtitle({ reduced, play }: { reduced: boolean; play: boolean }) {
  const [count, setCount] = useState(reduced ? SUBTITLE.length : 0);

  useEffect(() => {
    if (reduced) {
      setCount(SUBTITLE.length);
      return;
    }
    if (!play) return;
    let interval = 0;
    const timeout = window.setTimeout(() => {
      let shown = 0;
      interval = window.setInterval(() => {
        shown += 1;
        setCount(shown);
        if (shown >= SUBTITLE.length) window.clearInterval(interval);
      }, boot.subtitle.charMs);
    }, boot.subtitle.delay * 1000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [play, reduced]);

  return (
    <p className="subtitle" aria-label={SUBTITLE}>
      <span aria-hidden="true">{SUBTITLE.slice(0, count)}</span>
      <motion.span
        className="cursor"
        aria-hidden="true"
        animate={reduced ? { opacity: 1 } : { opacity: [1, 1, 0, 0] }}
        transition={
          reduced
            ? { duration: 0 }
            : { duration: 1.06, repeat: Infinity, times: [0, 0.49, 0.5, 1], ease: "linear" }
        }
      />
    </p>
  );
}
