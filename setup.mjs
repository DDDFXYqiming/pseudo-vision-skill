/**
 * setup.mjs — one-shot bootstrap for the pseudo-vision skill.
 *
 * 1. Verifies the Node version supports --experimental-strip-types (>= 22.6).
 * 2. Installs npm dependencies (sharp + tesseract.js) if node_modules is missing.
 * 3. Prepares tessdata/: copies plain .traineddata files from a local source
 *    (pi-pseudo-vision checkout) when available; otherwise downloads the gz
 *    packs from the tessdata CDN once. tessdata/ makes OCR fully offline.
 *
 * Idempotent: re-running is a no-op when everything is in place.
 */
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

// --- 1. Node version gate -------------------------------------------------
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 6)) {
    console.error(`pseudo-vision setup: Node >= 22.6 required (got ${process.versions.node}).`);
    process.exit(1);
}

// --- 2. Dependencies ------------------------------------------------------
const nm = join(root, "node_modules");
if (!existsSync(join(nm, "sharp")) || !existsSync(join(nm, "tesseract.js"))) {
    console.log("pseudo-vision setup: installing dependencies (sharp, tesseract.js)…");
    execSync("npm install --no-audit --no-fund", { cwd: root, stdio: "inherit" });
} else {
    console.log("pseudo-vision setup: dependencies OK");
}

// --- 3. tessdata ----------------------------------------------------------
const tessdataDir = join(root, "tessdata");
mkdirSync(tessdataDir, { recursive: true });
const have = new Set(readdirSync(tessdataDir));

const sources = [
    // Local checkouts of the sibling projects carry plain .traineddata files.
    join(root, "..", "pi-pseudo-vision"),
    join(root, "..", "dsh-pseudo-vision"),
];

function copyLangsFrom(srcDir) {
    let copied = 0;
    for (const lang of ["chi_sim", "eng"]) {
        if (have.has(`${lang}.traineddata`)) continue;
        const src = join(srcDir, `${lang}.traineddata`);
        if (existsSync(src)) {
            copyFileSync(src, join(tessdataDir, `${lang}.traineddata`));
            have.add(`${lang}.traineddata`);
            copied += 1;
            console.log(`pseudo-vision setup: copied ${lang}.traineddata from ${srcDir}`);
        }
    }
    return copied;
}

for (const src of sources) copyLangsFrom(src);

if (!have.has("chi_sim.traineddata") || !have.has("eng.traineddata")) {
    console.log(
        "pseudo-vision setup: tessdata incomplete — OCR will download language packs "
        + "from the CDN on first use (set PV_TESSDATA to skip this later). "
        + "To pre-seed manually, place chi_sim.traineddata + eng.traineddata in "
        + tessdataDir,
    );
} else {
    console.log("pseudo-vision setup: tessdata OK (fully offline OCR)");
}

console.log("pseudo-vision setup: done. Try: npm run pv -- <image-path>");
