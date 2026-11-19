// Prints final-documentation.html to the repository root as a PDF with headless Chrome.
//   node docs/final-report/build-pdf.mjs
// Needs Google Chrome (macOS path below, or set CHROME=/path/to/chrome).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const input = "file://" + join(here, "final-documentation.html");
const output = join(here, "..", "..", "ClubSpace-Final-Documentation-Group19.pdf");
const chromePath = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = mkdtempSync(join(tmpdir(), "clubspace-pdf-"));
const port = 9334;

const chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); } }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const pending = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, (d) => (d.error ? rej(new Error(d.error.message)) : res(d.result))); ws.send(JSON.stringify({ id, method, params })); });

try {
  await send("Page.enable");
  await send("Page.navigate", { url: input });
  await send("Runtime.evaluate", {
    expression: `new Promise(async (r) => { if (document.readyState !== 'complete') await new Promise((x) => addEventListener('load', x)); await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode().catch(() => {}))); r(true); })`,
    awaitPromise: true,
  });
  await sleep(500);
  const footer = `<div style="width:100%;font:7.5px Inter,Arial,sans-serif;color:#8a93a3;padding:0 16mm;display:flex;justify-content:space-between"><span>ClubSpace · COMP3322 Group 19 · Final Documentation</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
  const { data } = await send("Page.printToPDF", {
    printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
    headerTemplate: "<span></span>", footerTemplate: footer,
  });
  writeFileSync(output, Buffer.from(data, "base64"));
  console.log("Wrote", output);
} finally {
  ws.close(); chrome.kill(); await sleep(300); rmSync(profile, { recursive: true, force: true });
}
