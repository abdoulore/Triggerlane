import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../apps/web/.next/static/", import.meta.url));
const limits = {
  // Set just above what one interface actually ships, measured after
  // ghost-app.tsx was deleted: 2,000,684 static, 1,792,343 of it JavaScript,
  // 718,489 in the largest chunk. A ceiling with half a megabyte of slack
  // catches nothing, so these sit roughly 7% above the real numbers. Expect to
  // lower them again when the landing stops carrying three.js.
  totalStaticBytes: 2_150_000,
  totalJavaScriptBytes: 1_920_000,
  largestJavaScriptBytes: 780_000,
};

async function files(path) {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const target = join(path, entry.name);
    return entry.isDirectory() ? files(target) : [target];
  }))).flat();
}

const all = await files(root);
const measured = await Promise.all(all.map(async (path) => ({ path, bytes: (await stat(path)).size })));
const javascript = measured.filter((file) => file.path.endsWith(".js"));
const result = {
  totalStaticBytes: measured.reduce((sum, file) => sum + file.bytes, 0),
  totalJavaScriptBytes: javascript.reduce((sum, file) => sum + file.bytes, 0),
  largestJavaScriptBytes: Math.max(0, ...javascript.map((file) => file.bytes)),
};

let failed = false;
for (const [metric, limit] of Object.entries(limits)) {
  const value = result[metric];
  const pass = value <= limit;
  console.log(`${pass ? "PASS" : "FAIL"} ${metric}: ${value.toLocaleString()} / ${limit.toLocaleString()} bytes`);
  failed ||= !pass;
}

if (failed) process.exitCode = 1;
