import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
const version = packageJson.version;
const header = new RegExp(`^## ${version.replaceAll(".", "\\.")}[^\\n]*$`, "m");
const headerMatch = header.exec(changelog);
const sectionStart = headerMatch
  ? changelog.indexOf("\n", headerMatch.index) + 1
  : -1;
const nextSection =
  sectionStart >= 0 ? changelog.indexOf("\n## ", sectionStart) : -1;
const section =
  sectionStart >= 0
    ? changelog.slice(
        sectionStart,
        nextSection >= 0 ? nextSection : changelog.length,
      )
    : undefined;
const destination = process.argv[2];

if (!destination) {
  throw new Error("Provide an output Markdown path.");
}
if (!section?.trim()) {
  throw new Error(`CHANGELOG.md has no notes for ${version}.`);
}

const notes = `## Recommended Windows download

Download **\`aletheia_${version}_x64-setup.exe\`** for the normal Windows installation. It includes Start Menu integration, an uninstaller, and WebView2 runtime handling. No developer tools are required.

The standalone **\`aletheia_${version}_x64.exe\`** is also included for testing.

## Added and changed

${section.trim()}

All investigation data remains local. Aletheia does not test credentials or automate logins.
`;

writeFileSync(destination, notes, "utf8");
console.log(`Wrote release notes for ${version}.`);
