import { useEffect, useState, useSyncExternalStore } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { boot, markerSpring } from "../lib/motion";

const RAIL_LINE = 15;
const LIVE_GLYPHS = ["░", "▒", "▓", "║", "╬", "·"] as const;
const NOISE = ["░", "▒", "▓", "·", " "] as const;

type Side = "left" | "right";
type Tone = "spine" | "dim";
type Cell = { ch: string; tone: Tone };

function useRailColumns(): number {
  const query = "(min-width: 641px)";
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => (window.matchMedia(query).matches ? 6 : 3),
    () => 6,
  );
}

function useRowCount(): number {
  const measure = () => Math.max(12, Math.ceil(window.innerHeight / RAIL_LINE));
  const [rows, setRows] = useState(measure);
  useEffect(() => {
    const onResize = () => setRows(measure());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return rows;
}

function cellsFor(row: number, last: number, side: Side, cols: number, live?: string): Cell[] {
  if (cols > 3) return wideCells(row, last, side, cols, live);
  return narrowCells(row, last, side, live);
}

function narrowCells(row: number, last: number, side: Side, live?: string): Cell[] {
  const spine = (ch: string): Cell => ({ ch, tone: "spine" });
  const dim = (ch: string): Cell => ({ ch, tone: "dim" });

  if (row === 0) {
    return side === "left"
      ? [dim("─"), dim("─"), spine("╔")]
      : [spine("╗"), dim("─"), dim("─")];
  }
  if (row === last) {
    return side === "left"
      ? [dim("─"), dim("─"), spine("╚")]
      : [spine("╝"), dim("─"), dim("─")];
  }

  const n = (row * 17 + (side === "left" ? 3 : 9)) % 10;
  const mid = n === 0 ? "╬" : n === 1 ? "═" : n < 4 ? "·" : " ";
  const outer = live ?? NOISE[row % NOISE.length] ?? "░";

  if (row % 11 === 0) {
    return side === "left"
      ? [dim("╬"), dim("═"), spine("║")]
      : [spine("║"), dim("═"), dim("╬")];
  }

  return side === "left"
    ? [dim(outer), dim(mid), spine("║")]
    : [spine("║"), dim(mid), dim(outer)];
}

function wideCells(row: number, last: number, side: Side, cols: number, live?: string): Cell[] {
  const cells: Cell[] = Array.from({ length: cols }, () => ({ ch: " ", tone: "dim" }));
  const spineIndex = side === "left" ? cols - 1 : 0;
  const outer = side === "left" ? 0 : cols - 1;

  const set = (index: number, ch: string, tone: Tone = "dim") => {
    cells[index] = { ch, tone };
  };

  if (row === 0 || row === last) {
    for (let index = 0; index < cols; index += 1) set(index, "─");
    const cap = row === 0 ? (side === "left" ? "╔" : "╗") : side === "left" ? "╚" : "╝";
    set(spineIndex, cap, "spine");
    return cells;
  }

  set(spineIndex, "║", "spine");

  if (row % 11 === 0) {
    for (let index = 0; index < cols; index += 1) {
      if (index !== spineIndex) set(index, index === outer ? "╬" : "═");
    }
    return cells;
  }

  set(outer, live ?? NOISE[row % NOISE.length] ?? "░");

  const second = side === "left" ? 1 : cols - 2;
  const shade = (row * 3 + (side === "left" ? 0 : 2)) % 6;
  if (shade === 0) set(second, "▓");
  else if (shade === 1) set(second, "▒");
  else if (shade === 2) set(second, "░");
  else if (shade === 3) set(second, "·");

  const near = side === "left" ? cols - 2 : 1;
  if (row % 7 === 0) set(near, "═");
  else if (row % 5 === 0) set(near, "·");

  const mid = side === "left" ? 2 : cols - 3;
  if (row % 4 === 0) set(mid, "·");
  else if (row % 9 === 0) set(mid, "╬");

  return cells;
}

export function AsciiRail({ side, reduced, play }: { side: Side; reduced: boolean; play: boolean }) {
  const rows = useRowCount();
  const cols = useRailColumns();
  const [live, setLive] = useState<ReadonlyMap<number, string>>(() => new Map());
  const yRaw = useMotionValue(-40);
  const y = useSpring(yRaw, markerSpring);
  const markerOpacity = useMotionValue(0);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      yRaw.set(event.clientY - RAIL_LINE / 2);
      markerOpacity.set(1);
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [markerOpacity, yRaw]);

  useEffect(() => {
    if (reduced || !play) return;
    let timer = 0;
    const tick = () => {
      setLive((prev) => {
        const next = new Map(prev);
        const row = 1 + Math.floor(Math.random() * Math.max(1, rows - 2));
        const glyph = LIVE_GLYPHS[Math.floor(Math.random() * LIVE_GLYPHS.length)] ?? "░";
        next.set(row, glyph);
        const keys = [...next.keys()];
        while (keys.length > 4) {
          const drop = keys.shift();
          if (drop !== undefined) next.delete(drop);
        }
        return next;
      });
      timer = window.setTimeout(tick, 480 + Math.random() * 280);
    };
    timer = window.setTimeout(tick, boot.ambient.delay * 1000);
    return () => window.clearTimeout(timer);
  }, [play, reduced, rows]);

  const last = rows - 1;

  return (
    <motion.div
      className={`rail rail-${side}`}
      aria-hidden="true"
      initial={reduced ? "shown" : "hidden"}
      animate={play || reduced ? "shown" : "hidden"}
      variants={{
        hidden: {},
        shown: {
          transition: reduced
            ? { duration: 0 }
            : { delayChildren: boot.rails.delay, staggerChildren: boot.rails.stagger },
        },
      }}
    >
      {Array.from({ length: rows }, (_, row) => (
        <motion.div
          key={row}
          className="rail-row"
          variants={{
            hidden: { opacity: 0 },
            shown: { opacity: 1, transition: { duration: reduced ? 0 : 0.12 } },
          }}
        >
          {cellsFor(row, last, side, cols, live.get(row)).map((cell, index) => (
            <span key={index} className={cell.tone === "spine" ? "rail-spine" : "rail-dim"}>
              {cell.ch}
            </span>
          ))}
        </motion.div>
      ))}
      <motion.span className="rail-marker" style={{ y, opacity: markerOpacity }}>
        {side === "left" ? ">" : "<"}
      </motion.span>
    </motion.div>
  );
}
