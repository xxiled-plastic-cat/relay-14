import { motion } from "framer-motion";

export function CrtOverlay({
  reduced,
  play,
  boot = true,
}: {
  reduced: boolean;
  play: boolean;
  boot?: boolean;
}) {
  return (
    <>
      {boot && play && !reduced ? (
        <motion.div
          className="power-on"
          aria-hidden="true"
          initial={{ opacity: 0.55 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        />
      ) : null}
      <div className="crt" aria-hidden="true">
        <div className="crt-scanlines" />
        <div className="crt-vignette" />
        {play && !reduced ? (
          <motion.div
            className="crt-band"
            initial={{ top: "-18%" }}
            animate={{ top: ["-18%", "112%"] }}
            transition={{ duration: 9.5, repeat: Infinity, ease: "linear", delay: 0.4 }}
          />
        ) : null}
      </div>
    </>
  );
}
