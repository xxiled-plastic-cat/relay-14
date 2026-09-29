import { paymentMiddleware } from "@relay-14/middleware";
import { Hono } from "hono";

type DemoEnv = {
  PAY_TO: string;
  FACILITATOR_URL: string;
};

const FORTUNE_PRICE_WEI = "100000000000000";

const FORTUNES = [
  "The next block already knows your name.",
  "A small transfer can open a large door.",
  "Gas you pay yourself is freedom.",
  "The faucet is generous. The chain is patient.",
  "What you sign is what you send.",
];

const app = new Hono<{ Bindings: DemoEnv }>();

app.get("/health", (c) => {
  return c.json({ ok: true, service: "relay-14-demo" });
});

app.get(
  "/fortune",
  (c, next) =>
    paymentMiddleware({
      priceWei: FORTUNE_PRICE_WEI,
      payTo: c.env.PAY_TO,
      facilitatorUrl: c.env.FACILITATOR_URL,
      description: "A fortune from Relay-14",
      mimeType: "application/json",
      maxTimeoutSeconds: 60,
    })(c, next),
  (c) => {
    const index = Math.floor(Math.random() * FORTUNES.length);
    const fortune = FORTUNES[index] ?? FORTUNES[0];
    return c.json({ fortune });
  },
);

export default app;
