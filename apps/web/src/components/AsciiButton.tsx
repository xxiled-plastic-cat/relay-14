import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { boot } from "../lib/motion";

const POOL = "░▒▓#*+x/01";

function pickGlyph(): string {
  return POOL[Math.floor(Math.random() * POOL.length)] ?? "░";
}

function scrambled(text: string, progress: number): string {
  return text
    .split("")
    .map((char, index) => ((index + 1) / text.length <= progress ? char : pickGlyph()))
    .join("");
}

function useDecode(text: string, play: boolean, reduced: boolean) {
  const [value, setValue] = useState(reduced ? text : " ".repeat(text.length));
  const [ready, setReady] = useState(reduced);
  const scrambleTimer = useRef(0);

  useEffect(() => {
    if (reduced) {
      setValue(text);
      setReady(true);
      return;
    }
    if (!play) return;
    let interval = 0;
    let frame = 0;
    const frames = Math.max(8, Math.round(boot.buttons.decodeMs / 16));
    const timeout = window.setTimeout(() => {
      interval = window.setInterval(() => {
        frame += 1;
        const progress = frame / frames;
        if (frame >= frames) {
          setValue(text);
          setReady(true);
          window.clearInterval(interval);
          return;
        }
        setValue(scrambled(text, progress));
      }, 16);
    }, (boot.buttons.delay + 0.28) * 1000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [play, reduced, text]);

  const scramble = useCallback(() => {
    window.clearInterval(scrambleTimer.current);
    setValue(scrambled(text, 0));
    let frame = 0;
    const frames = 12;
    scrambleTimer.current = window.setInterval(() => {
      frame += 1;
      if (frame >= frames) {
        setValue(text);
        window.clearInterval(scrambleTimer.current);
        return;
      }
      setValue(scrambled(text, frame / frames));
    }, 16);
  }, [text]);

  useEffect(() => () => window.clearInterval(scrambleTimer.current), []);

  return { value, ready, scramble };
}

const leftBracket = {
  boot: { x: -22, opacity: 0 },
  idle: {
    x: 0,
    opacity: 1,
    transition: {
      delay: boot.buttons.delay,
      type: "spring" as const,
      stiffness: 360,
      damping: 22,
    },
  },
  hover: {
    x: -8,
    transition: { type: "spring" as const, stiffness: 480, damping: 18 },
  },
};

const rightBracket = {
  boot: { x: 22, opacity: 0 },
  idle: {
    x: 0,
    opacity: 1,
    transition: {
      delay: boot.buttons.delay,
      type: "spring" as const,
      stiffness: 360,
      damping: 22,
    },
  },
  hover: {
    x: 8,
    transition: { type: "spring" as const, stiffness: 480, damping: 18 },
  },
};

export function AsciiButton({
  href,
  label,
  reduced,
  play,
}: {
  href: string;
  label: string;
  reduced: boolean;
  play: boolean;
}) {
  const { value, ready, scramble } = useDecode(label, play, reduced);
  const shown = play || reduced;

  return (
    <motion.a
      className="ascii-btn"
      href={href}
      aria-label={label}
      initial={reduced ? "idle" : "boot"}
      animate={shown ? "idle" : "boot"}
      whileHover={reduced ? undefined : "hover"}
      whileTap={reduced ? undefined : { scale: 0.97 }}
      onHoverStart={() => {
        if (!reduced && ready) scramble();
      }}
    >
      <motion.span className="bracket" variants={leftBracket} aria-hidden="true">
        [
      </motion.span>
      <span className="btn-label">{value}</span>
      <motion.span className="bracket" variants={rightBracket} aria-hidden="true">
        ]
      </motion.span>
    </motion.a>
  );
}
