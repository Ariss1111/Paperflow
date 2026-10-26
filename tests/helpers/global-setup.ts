import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export default function setup() {
  const dir = path.resolve("tests/fixtures/generated");
  if (!fs.existsSync(path.join(dir, "text-5pages.pdf"))) {
    execFileSync(process.execPath, ["scripts/make-fixtures.mjs"], { stdio: "inherit" });
  }
}
