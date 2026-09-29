import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../apps/web/.next/static/", import.meta.url));
const limits = {
  // Measured with the price chart wired in: 2,171,588 static, 1,963,219 of it
  // JavaScript, 718,489 in the largest chunk. These sit about 6% above that.
  //
  // The previous ceiling was set before the chart shipped and broke as soon as
  // it did, which was avoidable: the chart was known to be owed at the time.
  //
  // Worth knowing when reading a failure here: totalStaticBytes sums every file
  // on disk, including chunks a route only fetches later, so splitting a
  // dependency out does not reduce it. largestJavaScriptBytes is the one that
  // tracks how heavy a single entry has become; it did not move when the
  // charting library arrived, which is how we know it landed in its own chunk.
  totalStaticBytes: 2_300_000,
  totalJavaScriptBytes: 2_080_000,
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
