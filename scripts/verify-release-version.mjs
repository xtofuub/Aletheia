import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
const tauriConfig = JSON.parse(
  readFileSync(resolve(root, "src-tauri", "tauri.conf.json"), "utf8"),
);
const cargoToml = readFileSync(
  resolve(root, "src-tauri", "Cargo.toml"),
  "utf8",
);
const cargoVersion = cargoToml.match(
  /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m,
)?.[1];

const versions = {
  package: packageJson.version,
  tauri: tauriConfig.version,
  cargo: cargoVersion,
};

if (
  !versions.package ||
  Object.values(versions).some((value) => value !== versions.package)
) {
  console.error(`Version mismatch: ${JSON.stringify(versions)}`);
  process.exit(1);
}

const releaseTag = process.env.GITHUB_REF_NAME;
if (releaseTag && releaseTag !== `v${versions.package}`) {
  console.error(
    `Release tag ${releaseTag} does not match project version v${versions.package}.`,
  );
  process.exit(1);
}

console.log(`Release version ${versions.package} is consistent.`);
