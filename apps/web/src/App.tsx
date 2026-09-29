import { useEffect, useState } from "react";
import { motion, useMotionValue, useReducedMotion } from "framer-motion";
import { AsciiButton } from "./components/AsciiButton";
import { AsciiRail } from "./components/AsciiRail";
import { CrtOverlay } from "./components/CrtOverlay";
import { Subtitle } from "./components/Subtitle";
import { Wordmark } from "./components/Wordmark";
import { boot } from "./lib/motion";
import { DocsPage } from "./pages/DocsPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { TxnsPage } from "./pages/TxnsPage";

function currentPath(): string {
  const path = window.location.pathname.replace(/\/+$/, "");
  return path.length > 0 ? path : "/";
}

function useFontsReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const finish = () => {
      if (!cancelled) setReady(true);
    };
    const timeout = window.setTimeout(finish, 1600);
    if (!("fonts" in document)) {
      finish();
      return () => {
        cancelled = true;
        window.clearTimeout(timeout);
      };
    }
    void Promise.all([
      document.fonts.load('16px "Sixtyfour Variable"'),
      document.fonts.load('16px "IBM Plex Mono"'),
    ]).then(finish, finish);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, []);

  return ready;
}

function Stage({ reduced, play }: { reduced: boolean; play: boolean }) {
  const opacity = useMotionValue(1);

  useEffect(() => {
    if (reduced || !play) return;
    let timer = 0;
    let dip = 0;
    const tick = () => {
      opacity.set(0.93 + Math.random() * 0.04);
      dip = window.setTimeout(() => opacity.set(1), 28 + Math.random() * 36);
      timer = window.setTimeout(tick, 600 + Math.random() * 2200);
    };
    timer = window.setTimeout(tick, boot.ambient.delay * 1000);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(dip);
    };
  }, [opacity, play, reduced]);

  return (
    <motion.main className="stage" style={{ opacity }}>
      <Wordmark reduced={reduced} play={play} />
      <Subtitle reduced={reduced} play={play} />
      <div className="actions">
        <AsciiButton href="/docs" label="DOCS" reduced={reduced} play={play} />
        <AsciiButton href="/txns" label="TXNS" reduced={reduced} play={play} />
      </div>
    </motion.main>
  );
}

function Inner({ path }: { path: string }) {
  if (path === "/docs") return <DocsPage />;
  if (path === "/txns") return <TxnsPage />;
  return <NotFoundPage />;
}

export function App() {
  const reduced = useReducedMotion() === true;
  const fontsReady = useFontsReady();
  const path = currentPath();
  const home = path === "/";
  const play = home ? fontsReady : true;

  return (
    <>
      <CrtOverlay reduced={reduced} play={play} boot={home} />
      <motion.div
        className="page"
        initial={{ opacity: 0 }}
        animate={{ opacity: play ? 1 : 0 }}
        transition={{ duration: reduced || !home ? 0 : 0.22 }}
      >
        <AsciiRail side="left" reduced={reduced || !home} play={play} />
        {home ? <Stage reduced={reduced} play={play} /> : <Inner path={path} />}
        <AsciiRail side="right" reduced={reduced || !home} play={play} />
      </motion.div>
    </>
  );
}
