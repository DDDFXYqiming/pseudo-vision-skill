/**
 * pv.ts — pseudo-vision CLI entry point.
 *
 * One command, five modes, covering every tool the dsh / pi plugins exposed:
 *
 *   full (default)  pseudo_vision_convert — the complete evidence pipeline
 *                   (preprocessed OCR + digit verification + colour stats +
 *                   universal pixel scan + metadata), cached and capped at
 *                   32K chars. Identical output to the plugin auto-bridge.
 *   ocr             vision_ocr — budget-preprocessed OCR with low-confidence
 *                   retries and the digit verification pass.
 *   colors          vision_color_stats — 9-bucket colour share + luminance.
 *   scan            vision_pixel_scan — target-colour rows (default) or the
 *                   universal non-background row+column scan.
 *   meta            vision_meta — dimensions, format, corner/centre samples.
 *
 * Usage:
 *   node --experimental-strip-types scripts/pv.ts <image-path> [options]
 *
 * Options:
 *   --mode full|ocr|colors|scan|meta
 *   --budget auto|small|normal|large|mega   (ocr / full)
 *   --langs chi_sim+eng                     (ocr / full)
 *   --no-resize                             skip OCR budget resize (ocr / full)
 *   --bypass-cache                          recompute even if cached (full)
 *   --scan-mode target|universal            (scan; default target)
 *   --scan-target #ff0000                   (scan, target mode)
 *   --scan-threshold 0.05                   (scan; target default 0.05, universal 0.15)
 *   --json                                  machine-readable output
 *
 * Exit codes: 0 ok · 1 bad usage / guard rejection · 2 pipeline failure.
 */

import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Argument parsing (zero-dependency)
// ---------------------------------------------------------------------------

interface Args {
    file?: string;
    mode: "full" | "ocr" | "colors" | "scan" | "meta";
    budget: string;
    langs?: string;
    noResize: boolean;
    bypassCache: boolean;
    scanMode: "target" | "universal";
    scanTarget: string;
    scanThreshold?: number;
    json: boolean;
}

function parseArgs(argv: string[]): Args {
    const args: Args = {
        mode: "full",
        budget: "auto",
        noResize: false,
        bypassCache: false,
        scanMode: "target",
        scanTarget: "#ff0000",
        json: false,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i]!;
        switch (a) {
            case "--mode": args.mode = argv[++i] as Args["mode"]; break;
            case "--budget": args.budget = argv[++i] ?? "auto"; break;
            case "--langs": args.langs = argv[++i]; break;
            case "--no-resize": args.noResize = true; break;
            case "--bypass-cache": args.bypassCache = true; break;
            case "--scan-mode": args.scanMode = (argv[++i] as Args["scanMode"]) ?? "target"; break;
            case "--scan-target": args.scanTarget = argv[++i] ?? "#ff0000"; break;
            case "--scan-threshold": args.scanThreshold = Number(argv[++i]); break;
            case "--json": args.json = true; break;
            default:
                if (a.startsWith("--")) {
                    fail(`unknown option: ${a}`);
                } else if (args.file === undefined) {
                    args.file = a;
                } else {
                    fail(`unexpected extra argument: ${a}`);
                }
        }
    }
    if (!["full", "ocr", "colors", "scan", "meta", "convert"].includes(args.mode)) {
        fail(`invalid --mode: ${args.mode}`);
    }
    if (args.mode === "convert") args.mode = "full";
    if (args.file === undefined) fail("missing <image-path> argument");
    return args;
}

function fail(message: string): never {
    console.error(`pseudo-vision: ${message}`);
    process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

// ---------------------------------------------------------------------------
// Offline tessdata: prefer the bundled tessdata/ directory when present.
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const skillRoot = join(fileURLToPath(import.meta.url), "..", "..");
const bundledTessdata = join(skillRoot, "tessdata");
if (!process.env.PV_TESSDATA && existsSync(join(bundledTessdata, "eng.traineddata"))) {
    process.env.PV_TESSDATA = bundledTessdata;
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

const cacheDir = process.env.PV_CACHE_DIR ?? join(skillRoot, "cache");

async function runFull(): Promise<{ text: string; sha256: string }> {
    const { imageToText, sha256Of } = await import("../src/bridge.ts");
    const { readImageFileSafe } = await import("../src/vision/file-guard.ts");
    const bytes = await readImageFileSafe(args.file!);
    const sha256 = sha256Of(bytes);
    const text = await imageToText(
        { sha256, bytes, mimeType: "image/png" },
        {
            cacheDir,
            bypassCache: args.bypassCache,
            ocrBudget: args.budget,
            langs: args.langs,
            ocrNoResize: args.noResize,
        },
    );
    // The algorithm layer is shared with the pi/dsh plugins and hardcodes the
    // pi prefix; rebrand the evidence header for the standalone skill.
    return { text: text.replace(/^\[pi-pseudo-vision\]/, "[pseudo-vision]"), sha256 };
}

async function runOcr(): Promise<{ text: string; lines: number; retries: number; digitFixes: number }> {
    const { readImageFileSafe } = await import("../src/vision/file-guard.ts");
    const { preprocessForOcr } = await import("../src/vision/preprocess.ts");
    const {
        ocrWithLowConfidenceRetry,
        formatOcrBlock,
        formatOcrRetryBlock,
        formatDigitFixBlock,
    } = await import("../src/vision/ocr.ts");
    const bytes = await readImageFileSafe(args.file!);
    // Same parameters as the plugin's vision_ocr tool.
    const pre = await preprocessForOcr(bytes, args.budget, undefined, args.noResize);
    const ocr = await ocrWithLowConfidenceRetry(pre.bytes, args.langs ?? "chi_sim+eng", {
        threshold: 60,
        maxRegions: 3,
        upscale: 2,
    });
    const text = [
        formatOcrBlock(ocr.initial),
        formatOcrRetryBlock(ocr),
        formatDigitFixBlock(ocr.digitFixes),
    ].filter((b) => b.length > 0).join("\n");
    return {
        text,
        lines: ocr.initial.lines.length,
        retries: ocr.retries.length,
        digitFixes: ocr.digitFixes.length,
    };
}

async function runColors(): Promise<{ text: string; totalPixels: number }> {
    const { readImageFileSafe } = await import("../src/vision/file-guard.ts");
    const { computeColorStats, formatColorStatsBlock } = await import("../src/vision/color-stats.ts");
    const bytes = await readImageFileSafe(args.file!);
    const stats = await computeColorStats(bytes);
    return { text: formatColorStatsBlock(stats), totalPixels: stats.totalPixels };
}

async function runMeta(): Promise<{ text: string; width: number; height: number }> {
    const { readImageFileSafe } = await import("../src/vision/file-guard.ts");
    const { readMeta, formatMetaBlock } = await import("../src/vision/meta.ts");
    const bytes = await readImageFileSafe(args.file!);
    const result = await readMeta(bytes);
    return {
        text: formatMetaBlock(result),
        width: result.meta.width ?? 0,
        height: result.meta.height ?? 0,
    };
}

async function runScan(): Promise<{ text: string; details: Record<string, unknown> }> {
    const sharp = (await import("sharp")).default;
    const { readImageFileSafe } = await import("../src/vision/file-guard.ts");
    const {
        pixelScan,
        formatPixelScanBlock,
        pixelScanUniversal,
        formatUniversalScanBlock,
    } = await import("../src/vision/pixel-scan.ts");
    const { computeColorStats } = await import("../src/vision/color-stats.ts");
    const bytes = await readImageFileSafe(args.file!);

    if (args.scanMode === "universal") {
        // Same shared 512px downsample + background-bucket logic as the plugin.
        const { data, info } = await sharp(bytes)
            .resize({ width: 512, height: 512, fit: "inside" })
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        const raw = { data: data as Buffer, width: info.width, height: info.height, channels: info.channels };
        const stats = await computeColorStats(bytes);
        const backgroundBuckets = stats.buckets.filter((b) => b.share >= 0.30).map((b) => b.name);
        const result = await pixelScanUniversal(raw, {
            backgroundBuckets,
            threshold: args.scanThreshold ?? 0.15,
            backgroundCap: 0.9,
            maxHitsPerBucket: 5,
        });
        return {
            text: formatUniversalScanBlock(result),
            details: { mode: "universal", rowHits: result.rowHitCount, colHits: result.colHitCount },
        };
    }

    const result = await pixelScan(bytes, {
        target: args.scanTarget,
        threshold: args.scanThreshold ?? 0.05,
    });
    return {
        text: formatPixelScanBlock(result),
        details: { mode: "target", hits: result.rows.length, peak: result.peak?.y ?? null },
    };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

try {
    let payload: Record<string, unknown>;
    switch (args.mode) {
        case "full": {
            const r = await runFull();
            payload = { mode: "full", file: args.file, sha256: r.sha256.slice(0, 12), text: r.text };
            break;
        }
        case "ocr": {
            const r = await runOcr();
            payload = { mode: "ocr", file: args.file, lines: r.lines, retries: r.retries, digitFixes: r.digitFixes, text: r.text };
            break;
        }
        case "colors": {
            const r = await runColors();
            payload = { mode: "colors", file: args.file, totalPixels: r.totalPixels, text: r.text };
            break;
        }
        case "scan": {
            const r = await runScan();
            payload = { mode: "scan", file: args.file, ...r.details, text: r.text };
            break;
        }
        case "meta": {
            const r = await runMeta();
            payload = { mode: "meta", file: args.file, width: r.width, height: r.height, text: r.text };
            break;
        }
    }
    if (args.json) {
        console.log(JSON.stringify(payload, null, 2));
    } else {
        console.log(payload.text as string);
    }
    process.exit(0);
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.json) {
        console.log(JSON.stringify({ mode: args.mode, file: args.file, error: message }));
    } else {
        console.error(`pseudo-vision: ${message}`);
    }
    // Guard rejections (bad file) exit 1; pipeline failures exit 2.
    process.exit(/vision: /.test(message) ? 1 : 2);
}
