#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";

const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const blockedExtensions = new Set([
  ".db",
  ".sqlite",
  ".sqlite3",
  ".dump",
  ".breach",
  ".log",
]);
const suspiciousNames = /(^|[\\/])(848|e_848)\.txt$/i;
const likelyCredentialPair =
  /[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,63})\s*[:|;,]\s*[^\s:|;,]{4,}/gi;
const emailPattern = /[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,63})/gi;
const reservedFixtureDomain =
  /^(?:[A-Z0-9-]+\.)*(?:example\.(?:com|net|org)|test)$/i;

function stagedFiles() {
  const output = execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
    { encoding: "utf8" },
  );
  return output.split("\0").filter(Boolean);
}

function fail(message) {
  process.stderr.write(`SAFETY BLOCK: ${message}\n`);
  process.exitCode = 1;
}

for (const file of stagedFiles()) {
  let stat;
  try {
    stat = statSync(file);
  } catch {
    continue;
  }

  if (suspiciousNames.test(file)) {
    fail(`${file} matches a protected local dataset name.`);
    continue;
  }

  const extension = extname(file).toLowerCase();
  if (blockedExtensions.has(extension)) {
    fail(`${file} has a generated database, dump, or log extension.`);
    continue;
  }

  if (
    stat.size > MAX_TEXT_BYTES &&
    [".txt", ".csv", ".tsv", ".jsonl", ".ndjson"].includes(extension)
  ) {
    fail(`${file} is a large text-like file (${stat.size} bytes).`);
    continue;
  }

  if (stat.size > 1024 * 1024) {
    continue;
  }

  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  if (file.replaceAll("\\", "/").startsWith("tests/fixtures/")) {
    for (const match of content.matchAll(emailPattern)) {
      if (!reservedFixtureDomain.test(match[1] ?? "")) {
        fail(`${file} contains a non-reserved fixture email domain.`);
      }
    }
    continue;
  }

  for (const match of content.matchAll(likelyCredentialPair)) {
    if (!reservedFixtureDomain.test(match[1] ?? "")) {
      fail(`${file} contains an email plus credential-like delimiter pattern.`);
    }
  }
}

if (process.exitCode) {
  process.stderr.write(
    "Keep private datasets outside Git. Use invented example-domain fixtures only.\n",
  );
} else {
  process.stdout.write("Repository data safety check passed.\n");
}
