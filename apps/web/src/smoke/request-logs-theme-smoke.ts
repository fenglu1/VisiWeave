import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../styles/request-logs.css", import.meta.url), "utf8");

expect(!css.includes("var(--muted)"), "request logs CSS must not use the undefined --muted token");
expect(css.includes("--request-log-page-bg"), "request logs CSS should define scoped light-theme tokens");
expect(
  css.includes('.app-root[data-canvas-theme="light"] .request-logs-page'),
  "request logs page should explicitly participate in the light theme"
);
expect(
  css.includes('.app-root[data-canvas-theme="dark"] .request-logs-page'),
  "request logs page should explicitly participate in the dark theme"
);
expect(
  (css.match(/var\(--request-log-muted\)/gu) ?? []).length >= 6,
  "request logs muted text should use the scoped theme token"
);

console.log("request logs theme smoke checks passed");

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
