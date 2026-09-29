import type { Transition } from "framer-motion";

/** Shared boot timeline, in seconds. Components read this instead of picking their own delays. */
export const boot = {
  rails: { delay: 0, stagger: 0.012 },
  wordmark: { delay: 0.4, stagger: 0.085 },
  subtitle: { delay: 1.5, charMs: 28 },
  buttons: { delay: 2.3, decodeMs: 300 },
  ambient: { delay: 2.9 },
} as const;

export const easeOut: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const settle: Transition = {
  type: "spring",
  stiffness: 160,
  damping: 13,
  mass: 0.85,
};

export const snappy: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 24,
};

export const markerSpring = {
  stiffness: 140,
  damping: 20,
  mass: 0.4,
} as const;

export const WORDMARK = ["R", "E", "L", "A", "Y", "-", "1", "4"] as const;

export const SUBTITLE = "The Facilitator for x402 on LitVM";

export const REST_BLED = 10;
export const REST_SCAN = 0;
export const REST_GLOW = 14;
