/**
 * sync-from-pi.mjs — pull the algorithm layer from the pi-pseudo-vision
 * checkout (the single algorithm source of truth) into this skill.
 *
 * Run after any algorithm change in pi-pseudo-vision:
 *   node sync-from-pi.mjs [--path <pi-checkout>]
 *
 * Copies src/vision/*, src/bridge.ts and the algorithm tests, then reminds
 * you to run the test suite.
 */
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

const argIdx = process.argv.indexOf("--path");
const piRoot = argIdx !== -1
    ? process.argv[argIdx + 1]
    : join(root, "..", "pi-pseudo-vision");

const copies = [
    ...readdirSync(join(piRoot, "src", "vision"))
        .filter((f) => f.endsWith(".ts"))
        .map((f) => [`src/vision/${f}`, `src/vision/${f}`]),
    ["src/bridge.ts", "src/bridge.ts"],
    ["tests/vision.test.ts", "tests/vision.test.ts"],
    ["tests/regression.test.ts", "tests/regression.test.ts"],
    ["tests/fixtures.ts", "tests/fixtures.ts"],
];

for (const [src, dst] of copies) {
    const absSrc = join(piRoot, src);
    const absDst = join(root, dst);
    mkdirSync(dirname(absDst), { recursive: true });
    copyFileSync(absSrc, absDst);
    console.log(`synced ${src}`);
}

console.log(
    `\npseudo-vision skill: ${copies.length} files synced from ${piRoot}\n`
    + "Next: npm test  (and re-run setup.mjs if dependencies changed)",
);
