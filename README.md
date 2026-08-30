简体中文 | [English](README.en.md)

# pseudo-vision-skill

> 一个跨框架的"工具层视觉" skill。图片在本机被拆成四路证据，OCR 文字、颜色统计、像素扫描和元信息，纯文本模型的智能体拿到这包证据就能读图。同一套算法层可以装进 Claude Code / pi / Hermes / WorkBuddy 等任何支持 skill 的框架，**无需逐个开发插件**。计算全程发生在本机，**无外部视觉 API**。

**算法与 [dsh-pseudo-vision](https://github.com/DDDFXYqiming/dsh-pseudo-vision) / [pi-pseudo-vision](https://github.com/DDDFXYqiming/pi-pseudo-vision) 插件完全同源**。算法只有一份权威源（pi 仓库），改完用 `sync-from-pi.mjs` 一键同步过来。

**实机验证通过**。pi 加 kimi-for-coding 这样的纯文本模型，配上本 skill，完整读图成功。OCR 全对（含中文），深色主题判断正确，布局定位到了行级。

## 为什么是 skill 而不是插件

- **dsh** 的准入校验极严，粘贴图片时直接拒绝发给 text-only 模型，要接住这条路只能靠插件级路由接管，所以 dsh-pseudo-vision 保留插件形态
- **其他框架**（pi / Claude Code / Hermes 等）不拦截。text-only 模型能感觉到面前有一张图，只是自己读不出来，这种情况一个 skill 就够了
- 一份实现，装遍所有框架。算法改动只发生在算法源仓库，跑一次 `sync` 就分发到位

## 提供的能力（CLI 模式 ↔ 插件工具对照）

| CLI 模式 | 等价插件工具 | 作用 | 实现 |
|---|---|---|---|
| `full`（默认） | `pseudo_vision_convert` | 四件套聚合为单一 `<pseudo-vision-context>` 证据块（缓存 + 32K 封顶 + 分块 + OCR 失败写回） | sharp + tesseract.js |
| `--mode ocr` | `vision_ocr` | 预算预处理 OCR + 低置信度重试 + 数字复核通道（IP/URL/端口 `0↔6/9/8` 字形重识别） | tesseract.js（chi_sim + eng） |
| `--mode colors` | `vision_color_stats` | 9 桶（白/黑/灰/红/绿/蓝/黄/青/品红/其他）像素占比 + 平均亮度 | sharp + 直方图 |
| `--mode scan` | `vision_pixel_scan` | `target` 找指定颜色行；`universal` 输出全部非背景色行/列（背景豁免 + 部分带 surfaced） | sharp raw pixel |
| `--mode meta` | `vision_meta` | 尺寸、格式、色彩空间、四角/中心采样 | sharp metadata |

> 文件护栏（v0.1.0）。所有入口先过一道 64MB 大小上限加 PNG/JPEG/WebP/GIF magic-number 嗅探，任意二进制或文本文件进不了 OCR 管线。
>
> 离线 OCR（v0.1.0）。`tessdata/` 内置语言包，配合 `PV_TESSDATA` 环境变量（`langPath + gzip:false`），首次运行不再从 CDN 拉语言包，完全离线可用。

## 安装

```bash
git clone https://github.com/DDDFXYqiming/pseudo-vision-skill.git
cd pseudo-vision-skill && node setup.mjs   # 一键：npm 依赖 + 离线语言包
```

**装进你的框架**，任选其一。目录结构本身就符合 skill 规范，`SKILL.md`、`scripts/` 和 `src/` 一样不缺。

```bash
# 通用（pi / Claude Code 等支持 ~/.agents/skills 约定的框架）
cp -r pseudo-vision-skill ~/.agents/skills/pseudo-vision

# pi
cp -r pseudo-vision-skill ~/.pi/agent/skills/pseudo-vision

# Claude Code（全局或项目级）
cp -r pseudo-vision-skill ~/.claude/skills/pseudo-vision
# 或 cp -r pseudo-vision-skill <项目>/.claude/skills/pseudo-vision

# WorkBuddy
cp -r pseudo-vision-skill ~/.workbuddy/skills/pseudo-vision

# 兜底：把 SKILL.md 内容贴进 project instructions，脚本写绝对路径
```

Windows 下建议用 junction 链接（`New-Item -ItemType Junction`）代替拷贝，工作区里改代码即时生效。

## 使用

skill 装好后，LLM 收到图片会自动触发。也可以手动跑 CLI。

```bash
# 完整转换（等价插件全部 4 工具聚合）
node --experimental-strip-types scripts/pv.ts <图片路径>

# 单项查询
node --experimental-strip-types scripts/pv.ts <图片路径> --mode ocr
node --experimental-strip-types scripts/pv.ts <图片路径> --mode colors
node --experimental-strip-types scripts/pv.ts <图片路径> --mode scan --scan-mode universal
node --experimental-strip-types scripts/pv.ts <图片路径> --mode meta

# 常用选项
--budget large       # 密集表格/小字
--langs chi_sim+eng  # tesseract 语言
--json               # 结构化输出
--bypass-cache       # 强制重算
```

需要 Node ≥ 22.6。`--experimental-strip-types` 直接跑 TypeScript 源码，没有构建步骤。

## 效果示例

`pi + kimi-for-coding`（纯文本模型）读一张终端风格的截图，下面贴的是模型实际收到的伪视觉证据。

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

模型靠这包结构化证据"脑补"出整张图。IP、端口这类数字关键 token 由复核通道兜底，证据完全可审计。

## 兼容框架

| 框架 | 安装位置 | 状态 |
|---|---|---|
| pi | `~/.pi/agent/skills/pseudo-vision` | ✅ 实测通过（kimi-for-coding 纯文本读图） |
| Claude Code | `~/.claude/skills/` 或 `<项目>/.claude/skills/` | 按 skill 规范，即装即用 |
| Hermes agent | 按其 skill 机制 | 待实测 |
| WorkBuddy | `~/.workbuddy/skills/` | 待实测 |
| 任意框架 | project instructions + 绝对路径 | 兜底可用 |

## 算法同步

`pi-pseudo-vision` 是算法的唯一权威源，算法层在 `src/vision/`，桥接在 `src/bridge.ts`。上游更新算法之后，跑下面的命令。

```bash
node sync-from-pi.mjs   # 拉取算法层 + 测试，然后 npm test
```

## 权限

- 读取磁盘上的图片文件（64MB 上限 + 图片格式 magic-number 校验）
- 写入 `cache/` 缓存（键含 sha256、budget、langs、OCR 管线参数版本）
- 进程内 tesseract.js OCR + sharp；语言包在 `tessdata/`，离线运行
- 首次 `setup.mjs` 安装 npm 依赖（sharp/tesseract.js 原生二进制）

**不会做的事**。图片不上传到任何外部 API，也不调用云端视觉服务。宿主框架代码保持原样，内置工具不被覆盖。

## 已知边界

- 复杂空间关系和真实照片的描述精度有限，伪视觉证据不等于真实的多模态理解
- OCR 仍可能认错非数字 token。IP、URL、端口、长数字这类数字关键 token 已由复核通道兜底
- 颜色统计只给占比，还原不了布局和图标细节
- 大图的 OCR 按 `--budget` 预算处理，高度超过 3000px 的长截图会先切块
- **skill 形态的边界**。它改写不了宿主的消息流，粘贴的图片需要有一个可访问的路径。dsh 的严格准入仍然要插件形态来接，dsh-pseudo-vision 因此保留
- **明确不做**。embedding 和外部 Vision API 不在范围内，那会违背"无模型"红线。自动桥接也不做，触发读图这一步需要 LLM 按 skill 指令来

## License

MIT
