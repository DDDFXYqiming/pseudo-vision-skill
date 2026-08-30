English | [简体中文](README.md)

# pseudo-vision-skill

> A cross-framework "tool-layer vision" skill. An image is decomposed locally into four kinds of evidence, OCR text, colour statistics, pixel scans, and metadata, so a text-only agent model can read it. One algorithm layer installs into Claude Code / pi / Hermes / WorkBuddy or any framework that supports skills, **no per-framework plugin development needed**. Everything runs on your machine, with **no external vision API**.

**Algorithm-identical** to the [dsh-pseudo-vision](https://github.com/DDDFXYqiming/dsh-pseudo-vision) / [pi-pseudo-vision](https://github.com/DDDFXYqiming/pi-pseudo-vision) plugins. There is one authoritative algorithm source (the pi repo), and changes reach this repo through a single `sync-from-pi.mjs` run.

**Verified end-to-end**. pi plus the kimi-for-coding text-only model, with this skill installed, read a full image successfully. Every OCR line came back correct, including the Chinese one, the dark theme was detected, and layout positions were localized down to individual rows.

## Why a skill instead of plugins

- **dsh** enforces a strict admission gate. Pasted images are rejected outright for text-only models, so catching that path requires plugin-level route takeover. dsh-pseudo-vision therefore stays a plugin.
- **Other frameworks** (pi / Claude Code / Hermes and so on) don't block anything. A text-only model knows an image is there, it just can't read it. A skill is enough for that case.
- One implementation installs everywhere. Algorithm changes happen once in the source repo, and one `sync` run distributes them.

## Capabilities (CLI mode ↔ plugin tool mapping)

| CLI mode | Plugin tool | What it does | Backend |
|---|---|---|---|
| `full` (default) | `pseudo_vision_convert` | Aggregate all four tools into one `<pseudo-vision-context>` evidence block (cached, capped at 32K chars, chunked, OCR-failure written back) | sharp + tesseract.js |
| `--mode ocr` | `vision_ocr` | Budget-preprocessed OCR + low-confidence retries + digit verification pass (IP/URL/port `0↔6/9/8` glyph re-OCR) | tesseract.js (chi_sim + eng) |
| `--mode colors` | `vision_color_stats` | 9-bucket (white/black/grey/red/green/blue/yellow/cyan/magenta/other) pixel share + average luminance | sharp + histogram |
| `--mode scan` | `vision_pixel_scan` | `target` finds rows of a colour; `universal` outputs all non-background row+col bands (background-exempt + partial bands surfaced) | sharp raw pixel |
| `--mode meta` | `vision_meta` | Dimensions, format, colour space, 4-corner + centre samples | sharp metadata |

> File guard (v0.1.0). Every entry point checks a 64MB size cap plus PNG/JPEG/WebP/GIF magic-number sniffing before anything reaches the OCR pipeline, so arbitrary binaries and text files cannot get in.
>
> Offline OCR (v0.1.0). Language packs ship inside `tessdata/`, and the `PV_TESSDATA` env var (`langPath + gzip:false`) points tesseract at them. The first run no longer pulls packs from a CDN, so the whole thing works offline.

## Install

```bash
git clone https://github.com/DDDFXYqiming/pseudo-vision-skill.git
cd pseudo-vision-skill && node setup.mjs   # one-shot: npm deps + offline tessdata
```

**Install into your framework** (pick one; the layout itself is the skill spec, with `SKILL.md`, `scripts/`, and `src/` all in place).

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

On Windows, prefer a junction link (`New-Item -ItemType Junction`) over copying, so edits in the workspace take effect immediately.

## Usage

Once installed, the skill is triggered by the LLM when an image arrives. You can also run the CLI by hand.

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

Requires Node >= 22.6. `--experimental-strip-types` runs the TypeScript sources directly, so there is no build step.

## Sample output

`pi + kimi-for-coding` (text-only) reading a terminal-style screenshot. What follows is the pseudo-vision evidence the model actually receives.

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

The model reconstructs the whole image from this structured evidence. Digit-critical tokens such as IPs and ports are guarded by the verification pass, and the evidence stays fully auditable.

## Framework compatibility

| Framework | Install location | Status |
|---|---|---|
| pi | `~/.pi/agent/skills/pseudo-vision` | ✅ Verified (kimi-for-coding text-only read) |
| Claude Code | `~/.claude/skills/` or `<project>/.claude/skills/` | Per skill spec, drop-in |
| Hermes agent | per its skill mechanism | TBD |
| WorkBuddy | `~/.workbuddy/skills/` | TBD |
| Any | project instructions + absolute path | Fallback works |

## Algorithm sync

`pi-pseudo-vision` is the single source of truth for the algorithm. The algorithm layer lives in `src/vision/`, the bridge in `src/bridge.ts`. After an upstream algorithm update, pull it in with the command below.

```bash
node sync-from-pi.mjs   # pull algorithm layer + tests, then npm test
```

## Permissions

- Reads image files on disk (64MB cap + image magic-number validation)
- Writes `cache/` (keyed by sha256, budget, langs, OCR pipeline version)
- In-process tesseract.js OCR + sharp; language packs in `tessdata/`, offline
- First `setup.mjs` installs npm dependencies (sharp / tesseract.js native binaries)

**What it never does**. Images are not uploaded to any external API, and no cloud vision service is called. Host framework code stays untouched, and no built-in tool gets overridden.

## Known limitations

- Description precision is limited for complex spatial relationships and real photos. Pseudo-vision evidence is not the same as real multimodal understanding.
- OCR can still misread non-digit tokens. Digit-critical tokens (IP/URL/port/long numbers) are covered by the verification pass.
- Colour stats give shares only. Layout and icon detail cannot be recovered from them.
- Large images have their OCR budgeted through `--budget`. Very tall screenshots (over 3000px) are chunked first.
- **Skill-form limitations**. A skill cannot rewrite the host message stream, and pasted images need an accessible path. dsh's strict admission still requires the plugin form, which is why dsh-pseudo-vision exists alongside.
- **Explicitly not doing**. Embeddings and external vision APIs are out of scope, because they violate the "no-model" red line. Auto-bridging is not attempted either, since the read must be triggered by an LLM following the skill instructions.

## License

MIT
