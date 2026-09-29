import { useCallback, useEffect, useRef } from "react";
import { animate, motion, useMotionTemplate, useMotionValue, useTransform } from "framer-motion";
import { boot, easeOut, REST_BLED, REST_GLOW, REST_SCAN, WORDMARK } from "../lib/motion";

function Glyph({
  char,
  index,
  reduced,
  play,
  register,
}: {
  char: string;
  index: number;
  reduced: boolean;
  play: boolean;
  register: (index: number, glitch: () => void) => () => void;
}) {
  const bled = useMotionValue(reduced ? REST_BLED : 100);
  const scan = useMotionValue(reduced ? REST_SCAN : 100);
  const glow = useMotionValue(reduced ? REST_GLOW : 40);
  const opacity = useMotionValue(reduced ? 1 : 0.15);
  const x = useMotionValue(0);
  const y = useMotionValue(reduced ? 0 : 14);
  const hovered = useRef(false);
  const settled = useRef(reduced);
  const glowWide = useTransform(glow, (value) => value * 2.6);
  const shadow = useMotionTemplate`0 0 ${glow}px rgba(255, 176, 0, 0.72), 0 0 ${glowWide}px rgba(255, 176, 0, 0.28)`;

  const glitch = useCallback(() => {
    if (hovered.current || !settled.current) return;
    void animate(scan, [scan.get(), 92, -28, REST_SCAN], {
      duration: 0.22,
      times: [0, 0.28, 0.62, 1],
      ease: "easeInOut",
    });
    void animate(bled, [bled.get(), 100, REST_BLED], {
      duration: 0.28,
      times: [0, 0.3, 1],
      ease: "easeOut",
    });
    void animate(x, [0, 4, -3, 0], { duration: 0.18, ease: "easeInOut" });
    void animate(glow, [glow.get(), 42, REST_GLOW], { duration: 0.28, ease: "easeOut" });
  }, [bled, glow, scan, x]);

  useEffect(() => register(index, glitch), [glitch, index, register]);

  useEffect(() => {
    if (reduced || !play) return;
    const delay = boot.wordmark.delay + index * boot.wordmark.stagger;
    const animations = [
      animate(bled, REST_BLED, { type: "spring", stiffness: 150, damping: 12, mass: 0.9, delay }),
      animate(scan, REST_SCAN, { type: "spring", stiffness: 130, damping: 11, mass: 0.85, delay }),
      animate(glow, REST_GLOW, { duration: 0.75, delay, ease: easeOut }),
      animate(opacity, [0.15, 1, 0.9, 1], { duration: 0.55, delay, times: [0, 0.42, 0.68, 1], ease: "easeOut" }),
      animate(y, 0, { type: "spring", stiffness: 240, damping: 14, delay }),
    ];
    const timer = window.setTimeout(() => {
      settled.current = true;
    }, (delay + 1.05) * 1000);
    return () => {
      for (const animation of animations) animation.stop();
      window.clearTimeout(timer);
      settled.current = false;
    };
  }, [bled, glow, index, opacity, play, reduced, scan, y]);

  return (
    <motion.span
      className="glyph"
      style={{
        x,
        y,
        opacity,
        textShadow: shadow,
        ["--bled" as string]: bled,
        ["--scan" as string]: scan,
      }}
      onHoverStart={() => {
        hovered.current = true;
        if (reduced || !settled.current) return;
        void animate(bled, 78, { type: "spring", stiffness: 520, damping: 14 });
        void animate(glow, 34, { type: "spring", stiffness: 420, damping: 16 });
      }}
      onHoverEnd={() => {
        hovered.current = false;
        if (reduced || !settled.current) return;
        void animate(bled, REST_BLED, { type: "spring", stiffness: 280, damping: 16 });
        void animate(glow, REST_GLOW, { type: "spring", stiffness: 280, damping: 18 });
      }}
    >
      {char}
    </motion.span>
  );
}

export function Wordmark({ reduced, play }: { reduced: boolean; play: boolean }) {
  const glitchers = useRef<Array<(() => void) | null>>([]);

  const register = useCallback((index: number, glitch: () => void) => {
    glitchers.current[index] = glitch;
    return () => {
      glitchers.current[index] = null;
    };
  }, []);

  useEffect(() => {
    if (reduced || !play) return;
    let timer = 0;
    const schedule = () => {
      const wait = 8000 + Math.random() * 6000;
      timer = window.setTimeout(() => {
        const index = Math.floor(Math.random() * WORDMARK.length);
        glitchers.current[index]?.();
        schedule();
      }, wait);
    };
    timer = window.setTimeout(schedule, boot.ambient.delay * 1000);
    return () => window.clearTimeout(timer);
  }, [play, reduced]);

  return (
    <h1 className="wordmark">
      {WORDMARK.map((char, index) => (
        <Glyph
          key={`${char}-${index}`}
          char={char}
          index={index}
          reduced={reduced}
          play={play}
          register={register}
        />
      ))}
    </h1>
  );
}
