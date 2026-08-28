English | [简体中文](README.md)

# pseudo-vision-skill

> Cross-framework "tool-layer vision" skill: decompose an image locally into OCR text + color statistics + pixel-scan + metadata, so any text-only agent model can "see". One algorithm layer, installable into Claude Code / pi / Hermes / WorkBuddy — no per-framework plugin development. Fully local, **no external vision API**.

**Algorithm-identical** to the [dsh-pseudo-vision](https://github.com/DDDFXYqiming/dsh-pseudo-vision) / [pi-pseudo-vision](https://github.com/DDDFXYqiming/pi-pseudo-vision) plugins — a single algorithm source (the pi repo) synced via `sync-from-pi.mjs`.

**Verified end-to-end** (pi + kimi-for-coding text-only model + this skill → full image read: OCR all correct incl. Chinese, dark-theme detection, row-level layout localization).

## Why a skill instead of plugins

- **dsh** enforces a strict admission gate: pasted images are rejected outright for text-only models — plugin-level route takeover is mandatory (dsh-pseudo-vision stays a plugin)
- **Other frameworks** (pi / Claude Code / Hermes …) don't block: text-only models know "there is an image", they just can't read it — a skill is enough
- One implementation, installable everywhere; algorithm changes happen once in the source repo and are distributed by `sync`

## Capabilities (CLI mode ↔ plugin tool mapping)

| CLI mode | Plugin tool | What it does | Backend |
|---|---|---|---|
| `full` (default) | `pseudo_vision_convert` | Aggregate all four tools into one `<pseudo-vision-context>` evidence block (cached, capped at 32K chars, chunked, OCR-failure written back) | sharp + tesseract.js |
| `--mode ocr` | `vision_ocr` | Budget-preprocessed OCR + low-confidence retries + digit verification pass (IP/URL/port `0↔6/9/8` glyph re-OCR) | tesseract.js (chi_sim + eng) |
| `--mode colors` | `vision_color_stats` | 9-bucket (white/black/grey/red/green/blue/yellow/cyan/magenta/other) pixel share + average luminance | sharp + histogram |
| `--mode scan` | `vision_pixel_scan` | `target`: find rows of a colour; `universal`: all non-background row+col bands (background-exempt + partial bands surfaced) | sharp raw pixel |
| `--mode meta` | `vision_meta` | Dimensions, format, colour space, 4-corner + centre samples | sharp metadata |

> File guard (v0.1.0): every entry point enforces a 64MB size cap + PNG/JPEG/WebP/GIF magic-number sniffing before OCR.
>
> Offline OCR (v0.1.0): bundled `tessdata/` + `PV_TESSDATA` env var (`langPath + gzip:false`) — no CDN round-trip on first use.

## Install

```bash
git clone https://github.com/DDDFXYqiming/pseudo-vision-skill.git
cd pseudo-vision-skill && node setup.mjs   # one-shot: npm deps + offline tessdata
```

**Install into your framework** (the layout is the skill spec: `SKILL.md` + `scripts/` + `src/`):

```bash
# Generic (pi / Claude Code and others honoring the ~/.agents/skills convention)
cp -r pseudo-vision-skill ~/.agents/skills/pseudo-vision

# pi
cp -r pseudo-vision-skill ~/.pi/agent/skills/pseudo-vision

# Claude Code (global or per-project)
cp -r pseudo-vision-skill ~/.claude/skills/pseudo-vision
# or cp -r pseudo-vision-skill <project>/.claude/skills/pseudo-vision

# WorkBuddy
cp -r pseudo-vision-skill ~/.workbuddy/skills/pseudo-vision

# Fallback: paste SKILL.md into project instructions, use absolute script paths
```

On Windows, prefer a junction link (`New-Item -ItemType Junction`) so workspace edits take effect instantly.

## Usage

The skill is triggered by the LLM when an image arrives; the CLI can also be run manually:

```bash
# Full conversion (equivalent to all four plugin tools aggregated)
node --experimental-strip-types scripts/pv.ts <image-path>

# Single queries
node --experimental-strip-types scripts/pv.ts <image-path> --mode ocr
node --experimental-strip-types scripts/pv.ts <image-path> --mode colors
node --experimental-strip-types scripts/pv.ts <image-path> --mode scan --scan-mode universal
node --experimental-strip-types scripts/pv.ts <image-path> --mode meta

# Options
--budget large       # dense tables / tiny text
--langs chi_sim+eng  # tesseract languages
--json               # structured output
--bypass-cache       # force recompute
```

Requires Node >= 22.6 (`--experimental-strip-types` runs the TypeScript sources directly, no build step).

## Sample output

`pi + kimi-for-coding` (text-only) reading a terminal-style screenshot — the pseudo-vision evidence the model receives:

```
[pseudo-vision] sha256=1aaa609de392 budget=normal 原图:image/png 21512B 预处理:灰度+反色 832×328 29544B
[OCR chi_sim+eng] 4 行
  · "pi web: http://127.0.0.1:3080"  x=0.334 y=0.198
  · "server listening on port 8080"  x=0.335 y=0.354
  · "伪视觉测试图片"  x=0.181 y=0.503
  · "build 20260828 ok"  x=0.221 y=0.659
[颜色统计] 总像素 98304
  · 平均亮度 47.9/255
  · grey 95.2%
  · other 4.0%
[像素扫描] 512×192 背景豁免:grey 3 条命中（行 2 / 列 1）
  · 行 y=69.3%  grey  82.9%
  · 行 y=69.3%  green  17.1%
  · 列 x=25.6%  grey  88.1%
[元信息] 尺寸 800×300  png  srgb
  · [TL] #282c34 (grey)  · [C] #282c34 (grey)
```

The model reconstructs the image from this structured evidence — digit-critical tokens (IP/port) are guarded by the verification pass, fully auditable.

## Framework compatibility

| Framework | Install location | Status |
|---|---|---|
| pi | `~/.pi/agent/skills/pseudo-vision` | ✅ Verified (kimi-for-coding text-only read) |
| Claude Code | `~/.claude/skills/` or `<project>/.claude/skills/` | Per skill spec, drop-in |
| Hermes agent | per its skill mechanism | TBD |
| WorkBuddy | `~/.workbuddy/skills/` | TBD |
| Any | project instructions + absolute path | Fallback works |

## Algorithm sync

`pi-pseudo-vision` is the single algorithm source of truth (`src/vision/` + `src/bridge.ts`). After algorithm updates:

```bash
node sync-from-pi.mjs   # pull algorithm layer + tests, then npm test
```

## Permissions

- Reads image files on disk (64MB cap + image magic-number validation)
- Writes `cache/` (keyed by sha256, budget, langs, OCR pipeline version)
- In-process tesseract.js OCR + sharp; language packs in `tessdata/`, offline
- First `setup.mjs` installs npm dependencies (sharp / tesseract.js native binaries)

**Never**: uploads images to external APIs / calls any cloud vision service / modifies host framework code / overrides built-in tools.

## Known limitations

- Complex spatial relationships, real photos: description precision is limited — pseudo-vision evidence ≠ real multimodal understanding
- OCR can still misread non-digit tokens; digit-critical tokens (IP/URL/port/long numbers) are covered by the verification pass
- Colour stats give shares only, not layout/icon detail
- Large images: OCR respects the `--budget`; very tall screenshots (> 3000px) are chunked first
- **Skill-form limitations**: cannot rewrite the host message stream (pasted images need an accessible path); dsh's strict admission still requires the plugin form (dsh-pseudo-vision stays)
- **Explicitly not doing**: embeddings / external vision APIs (violates the "no-model" red line) / auto-bridging (requires LLM to follow the skill instructions)

## License

MIT
