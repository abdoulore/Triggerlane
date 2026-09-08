import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = mkdtempSync(join(tmpdir(), "triggerlane-backup-test-"));
const source = join(root, "source");
const backup = join(root, "backup");
const restored = join(root, "restored");

try {
  mkdirSync(join(source, "base"), { recursive: true });
  writeFileSync(join(source, "base", "PG_VERSION"), "17\n");
  writeFileSync(join(source, "state.bin"), Buffer.from([0, 1, 2, 3, 255]));
  execFileSync(process.execPath, ["scripts/pglite-volume.mjs", "backup", source, backup], { stdio: "pipe" });
  const backupManifest = JSON.parse(readFileSync(join(backup, "triggerlane-backup-manifest.json"), "utf8"));
  assert.equal(backupManifest.files.length, 2);
  assert.equal(readFileSync(join(backup, "state.bin")).toString("hex"), "00010203ff");
  execFileSync(process.execPath, ["scripts/pglite-volume.mjs", "restore", backup, restored], { stdio: "pipe" });
  assert.equal(readFileSync(join(restored, "state.bin")).toString("hex"), "00010203ff");
  assert.throws(() => execFileSync(process.execPath, ["scripts/pglite-volume.mjs", "restore", backup, restored], { stdio: "pipe" }));
  console.log("PGlite offline backup and restore round trip passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
