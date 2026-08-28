简体中文 | [English](README.en.md)

# pseudo-vision-skill

> 跨框架的"工具层视觉" skill：把图片在本地拆解成 OCR 文字 + 颜色统计 + 像素扫描 + 元信息，让任意纯文本模型的智能体也能"看图"。同一个算法层，装进 Claude Code / pi / Hermes / WorkBuddy 等任意支持 skill 的框架，**无需逐个开发插件**。全程本机执行，**无外部视觉 API**。

**算法与 [dsh-pseudo-vision](https://github.com/DDDFXYqiming/dsh-pseudo-vision) / [pi-pseudo-vision](https://github.com/DDDFXYqiming/pi-pseudo-vision) 插件完全同源**——单一算法源（pi 仓库）通过 `sync-from-pi.mjs` 一键同步。

**实机验证通过**（pi + kimi-for-coding 纯文本模型 + 本 skill → 完整读图：OCR 全对含中文、深色主题判断、布局定位到行级）。

## 为什么是 skill 而不是插件

- **dsh** 的准入校验极其严格：粘贴图片时直接拒绝发给 text-only 模型，**必须**插件级接管路由（dsh-pseudo-vision 保留插件形态）
- **其他框架**（pi / Claude Code / Hermes 等）不拦截：text-only 模型能感知"有一张图"，只是读不了——这种情况 skill 就够了
- 一份实现，装遍所有框架；算法改动只发生在算法源仓库，`sync` 一键分发

## 提供的能力（CLI 模式 ↔ 插件工具对照）

| CLI 模式 | 等价插件工具 | 作用 | 实现 |
|---|---|---|---|
| `full`（默认） | `pseudo_vision_convert` | 四件套聚合为单一 `<pseudo-vision-context>` 证据块（缓存 + 32K 封顶 + 分块 + OCR 失败写回） | sharp + tesseract.js |
| `--mode ocr` | `vision_ocr` | 预算预处理 OCR + 低置信度重试 + 数字复核通道（IP/URL/端口 `0↔6/9/8` 字形重识别） | tesseract.js（chi_sim + eng） |
| `--mode colors` | `vision_color_stats` | 9 桶（白/黑/灰/红/绿/蓝/黄/青/品红/其他）像素占比 + 平均亮度 | sharp + 直方图 |
| `--mode scan` | `vision_pixel_scan` | `target` 找指定颜色行；`universal` 输出全部非背景色行/列（背景豁免 + 部分带 surfaced） | sharp raw pixel |
| `--mode meta` | `vision_meta` | 尺寸、格式、色彩空间、四角/中心采样 | sharp metadata |

> 文件护栏（v0.1.0）：所有入口先做 64MB 大小上限 + PNG/JPEG/WebP/GIF magic-number 嗅探，杜绝把任意二进制/文本丢进 OCR 管线。
>
> 离线 OCR（v0.1.0）：`tessdata/` 内置语言包 + `PV_TESSDATA` 环境变量（`langPath + gzip:false`），首次运行不再从 CDN 拉取语言包，完全离线可用。

## 安装

```bash
git clone https://github.com/DDDFXYqiming/pseudo-vision-skill.git
cd pseudo-vision-skill && node setup.mjs   # 一键：npm 依赖 + 离线语言包
```

**装进你的框架**（任选其一，目录结构即 skill 规范：`SKILL.md` + `scripts/` + `src/`）：

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

Windows 下建议用 junction 链接（`New-Item -ItemType Junction`），工作区改代码即时生效、免拷贝。

## 使用

skill 装好后由 LLM 在收到图片时自动触发；也可手动跑 CLI：

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

需要 Node ≥ 22.6（`--experimental-strip-types` 直跑 TypeScript 源码，无构建步骤）。

## 效果示例

`pi + kimi-for-coding`（纯文本）读取终端风格截图，模型收到的伪视觉证据：

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

模型基于以上结构化证据"脑补"出整图内容——数字关键 token（IP/端口）由复核通道兜底，证据完全可审计。

## 兼容框架

| 框架 | 安装位置 | 状态 |
|---|---|---|
| pi | `~/.pi/agent/skills/pseudo-vision` | ✅ 实测通过（kimi-for-coding 纯文本读图） |
| Claude Code | `~/.claude/skills/` 或 `<项目>/.claude/skills/` | 按 skill 规范，即装即用 |
| Hermes agent | 按其 skill 机制 | 待实测 |
| WorkBuddy | `~/.workbuddy/skills/` | 待实测 |
| 任意框架 | project instructions + 绝对路径 | 兜底可用 |

## 算法同步

`pi-pseudo-vision` 是算法唯一权威源（`src/vision/` + `src/bridge.ts`）。算法更新后：

```bash
node sync-from-pi.mjs   # 拉取算法层 + 测试，然后 npm test
```

## 权限

- 读取磁盘上的图片文件（64MB 上限 + 图片格式 magic-number 校验）
- 写入 `cache/` 缓存（键含 sha256、budget、langs、OCR 管线参数版本）
- 进程内 tesseract.js OCR + sharp；语言包在 `tessdata/`，离线运行
- 首次 `setup.mjs` 安装 npm 依赖（sharp/tesseract.js 原生二进制）

**不会**：上传图片到外部 API / 调用任何云端视觉服务 / 修改宿主框架代码 / 覆盖任何内置工具。

## 已知边界

- 复杂空间关系、真实照片：描述精度有限，伪视觉证据不等同于真实多模态理解
- OCR 仍可能认错非数字 token；数字关键 token（IP/URL/端口/长数字）已由复核通道兜底
- 颜色统计只给占比，无法还原布局/图标细节
- 大图：OCR 按 `--budget` 预算处理；超长截图（高 > 3000px）会先切块
- **skill 形态的边界**：无法自动改写宿主消息流（粘贴图需有可访问的路径）；dsh 的严格准入仍需插件形态（dsh-pseudo-vision 保留）
- **明确不做**：embedding / 外部 Vision API（违背"无模型"红线）/ 自动桥接（需 LLM 按 skill 指令触发）

## License

MIT
