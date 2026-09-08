import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const [mode, sourceArgument, destinationArgument] = process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!['backup', 'restore'].includes(mode) || !sourceArgument || !destinationArgument) {
  fail('Usage: node scripts/pglite-volume.mjs <backup|restore> <source-directory> <new-destination-directory>');
}

const source = resolve(sourceArgument);
const destination = resolve(destinationArgument);
if (!existsSync(source) || !lstatSync(source).isDirectory()) fail(`Source directory does not exist: ${source}`);
if (existsSync(destination)) fail(`Destination already exists; refusing to overwrite: ${destination}`);
if (source === destination || destination.startsWith(`${source}\\`) || destination.startsWith(`${source}/`)) fail('Destination must be outside the source directory.');

function filesBelow(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = join(prefix, entry.name);
    return entry.isDirectory() ? filesBelow(join(directory, entry.name), relative) : [relative];
  }).sort();
}

if (mode === 'restore') {
  const manifestPath = join(source, 'triggerlane-backup-manifest.json');
  if (!existsSync(manifestPath)) fail('Restore source has no Triggerlane backup manifest.');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const entry of manifest.files ?? []) {
    const file = join(source, entry.file);
    if (!existsSync(file)) fail(`Backup file is missing: ${entry.file}`);
    const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (digest !== entry.sha256) fail(`Backup checksum failed: ${entry.file}`);
  }
}

mkdirSync(destination, { recursive: false });
cpSync(source, destination, { recursive: true, force: false, errorOnExist: true });
const manifest = filesBelow(destination).filter((file) => file !== 'triggerlane-backup-manifest.json').map((file) => ({
  file,
  sha256: createHash('sha256').update(readFileSync(join(destination, file))).digest('hex'),
}));
if (mode === 'backup') writeFileSync(join(destination, 'triggerlane-backup-manifest.json'), `${JSON.stringify({ mode, source: basename(source), createdAt: new Date().toISOString(), files: manifest }, null, 2)}\n`, { flag: 'wx' });
console.log(`${mode === 'backup' ? 'Backup' : 'Restore copy'} created at ${destination} with ${manifest.length} verified files.`);
