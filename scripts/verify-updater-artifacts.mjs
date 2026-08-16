import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const releaseRoot = process.env.ALETHEIA_RELEASE_DIR
  ? resolve(process.env.ALETHEIA_RELEASE_DIR)
  : resolve(root, "release");
const { version } = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
const setupName = `aletheia_${version}_x64-setup.exe`;
const signatureName = `${setupName}.sig`;
const required = [
  setupName,
  signatureName,
  `aletheia_${version}_x64.exe`,
  `aletheia_${version}_x64.msi`,
  "latest.json",
  "SHA256SUMS.txt",
];

for (const name of required) {
  if (!existsSync(resolve(releaseRoot, name))) {
    throw new Error(`Missing updater release artifact: ${name}`);
  }
}

const manifestBytes = readFileSync(resolve(releaseRoot, "latest.json"));
if (
  manifestBytes.length >= 3 &&
  manifestBytes[0] === 0xef &&
  manifestBytes[1] === 0xbb &&
  manifestBytes[2] === 0xbf
) {
  throw new Error(
    "Updater manifest must be UTF-8 without a BOM; Tauri rejects BOM-prefixed JSON.",
  );
}
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const windows = manifest.platforms?.["windows-x86_64"];
const signature = readFileSync(
  resolve(releaseRoot, signatureName),
  "utf8",
).trim();
const expectedUrl = `https://github.com/xtofuub/Aletheia/releases/download/v${version}/${setupName}`;

if (manifest.version !== version) {
  throw new Error("Updater manifest version does not match package version.");
}
if (!windows || windows.url !== expectedUrl) {
  throw new Error("Updater manifest Windows URL is invalid.");
}
if (signature.length < 100 || windows.signature !== signature) {
  throw new Error(
    "Updater manifest signature does not match the NSIS signature.",
  );
}

const checksumLines = readFileSync(
  resolve(releaseRoot, "SHA256SUMS.txt"),
  "utf8",
)
  .trim()
  .split(/\r?\n/);
const checksums = new Map(
  checksumLines.map((line) => {
    const match = /^([0-9a-f]{64})\s{2}(.+)$/.exec(line);
    if (!match) throw new Error(`Invalid checksum line: ${line}`);
    return [match[2], match[1]];
  }),
);

for (const name of required.filter((value) => value !== "SHA256SUMS.txt")) {
  const actual = createHash("sha256")
    .update(readFileSync(resolve(releaseRoot, name)))
    .digest("hex");
  if (checksums.get(name) !== actual) {
    throw new Error(`Updater checksum mismatch: ${name}`);
  }
}

console.log(`Verified signed updater artifacts for Aletheia ${version}.`);
