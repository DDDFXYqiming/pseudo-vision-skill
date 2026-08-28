---
name: pseudo-vision
description: 本地伪视觉工具——当模型无法直接读取图片时，把图片转换为结构化文本证据（OCR 文字 + 数字复核 + 颜色统计 + 像素扫描 + 元信息）。当消息中包含图片/截图/照片且需要分析其内容、用户要求识别图中文字、描述图片、或提到"看图/识图/读图/图片里"时使用。纯本地执行（tesseract.js + sharp），无外部视觉 API。
---

# pseudo-vision：本地伪视觉

你（当前模型）可能无法直接读取图片内容。本 skill 用本地管线把图片转换为结构化文本证据，读完证据即可"看图"。

## 何时使用

- 用户消息附带图片（截图/照片），并询问图片内容、图中文字、界面状态等
- 你收到图片路径且任务需要图片内容（如分析 UI 截图、读取报错截图、识别表格）
- 用户说"看一下这张图 / 图里写了什么 / 这是什么界面"

**不要**说"我无法查看图片"——先运行本 skill。

## 能力清单

单个 CLI（`scripts/pv.ts`）覆盖 5 种模式，对应插件版全部工具：

| CLI 模式 | 等价插件工具 | 能力 |
|---|---|---|
| `full`（默认） | `pseudo_vision_convert` | 四件套聚合为单一证据块：预处理 OCR + 数字复核 + 颜色统计 + universal 像素扫描 + 元信息（带缓存、32K 封顶、超高图自动分块、OCR 失败写回） |
| `--mode ocr` | `vision_ocr` | 预算预处理 OCR + 低置信度区域放大重读 + 数字复核通道（IP/URL/端口/长数字的 `0↔6/9/8` 字形重识别，标点保持融合） |
| `--mode colors` | `vision_color_stats` | 9 桶（白/黑/灰/红/绿/蓝/黄/青/品红/其他）像素占比 + 平均亮度 |
| `--mode scan` | `vision_pixel_scan` | `target`：找指定颜色行（默认红 `#ff0000`）；`universal`：全部非背景色行/列（背景豁免 + 部分带 surfaced） |
| `--mode meta` | `vision_meta` | 尺寸、格式、色彩空间、四角 + 中心采样色 |

完整参数：

```
--mode full|ocr|colors|scan|meta   能力模式（默认 full）
--budget auto|small|normal|large|mega   OCR 分辨率预算（密集表格/小字用 large）
--langs chi_sim+eng                 tesseract 语言包
--no-resize                         跳过 OCR 预算缩放（保留增强）
--bypass-cache                      强制重算（默认命中 sha256 缓存）
--scan-mode target|universal        scan 模式（默认 target）
--scan-target #rrggbb               目标色（scan target 模式，默认 #ff0000）
--scan-threshold 0.05               行/列密度阈值
--json                              结构化输出
```

## 用法

设 `SKILL_DIR` 为本文件所在目录（下述命令中的相对路径都基于它）。

首次使用前若未初始化（缺 node_modules）：

```bash
node SKILL_DIR/setup.mjs
```

完整转换（推荐，等价于插件版全部 4 个工具的聚合证据）：

```bash
node --experimental-strip-types SKILL_DIR/scripts/pv.ts <图片绝对路径>
```

单项查询（可选）：

```bash
# 仅 OCR 文字（含低置信度重试 + IP/URL/端口数字复核）
node --experimental-strip-types SKILL_DIR/scripts/pv.ts <图片路径> --mode ocr

# 仅颜色统计（9 桶占比 + 平均亮度）
node --experimental-strip-types SKILL_DIR/scripts/pv.ts <图片路径> --mode colors

# 像素扫描：默认找指定颜色（红色）的行；universal 模式输出全部非背景色行/列
node --experimental-strip-types SKILL_DIR/scripts/pv.ts <图片路径> --mode scan --scan-mode universal

# 仅元信息（尺寸/格式/四角与中心采样色）
node --experimental-strip-types SKILL_DIR/scripts/pv.ts <图片路径> --mode meta
```

操作要点：

- 一次转换一张图；多张图逐张运行
- 需要程序化解析输出时加 `--json`（单对象输出：`mode` / `file` / 各模式详情字段 / `text` / `error`）
- 命令失败分两类：**护栏拒绝**（非图片文件 / 超 64MB，预期行为，换合法图片即可）与**管线失败**（证据块内带 `[OCR 失败: …]`，颜色/扫描/元信息块仍有效）
- 首次使用若报缺 `node_modules`，先跑 `node SKILL_DIR/setup.mjs`

## 获取图片路径

- 框架给出图片文件路径（常见于粘贴截图后）→ 直接使用该路径
- 图片以 base64 形式出现在消息中 → 先落盘再转换：
  ```bash
  echo "<base64 数据>" | base64 -d > /tmp/pv-image.png
  ```
- 你有 read_image / screenshot 类工具且其返回图片数据 → 先保存到文件

大文件注意：图片超过 64MB 或非 PNG/JPEG/WebP/GIF 会被护栏拒绝（这是预期行为）。

## 解读证据块

输出证据格式（各块含义）：

- `[pseudo-vision … sha256=… budget=…]`：原图指纹与所用预算
- `[OCR chi_sim+eng] N 行`：识别的文字行，`x=… y=…` 是归一化坐标（0-1，可用于定位）
- `[数字复核 N 处]`：对 IP/URL/端口/长数字的自动纠错记录（原读 → 纠正 + 置信度变化），**纠正后的值更可信**
- `[颜色统计]`：像素颜色分布 + 平均亮度（可推断深/浅色主题）
- `[像素扫描]`：非背景色的行/列分布（可推断布局结构、分割线、表格）
- `[元信息]`：尺寸/格式/四角与中心采样色
- `[OCR 失败: …]`：OCR 管线出错的原因（此时颜色/扫描/元信息仍有效）
- `[证据已截断: …]`：超大证据被截断到 32K 字符

## 能力边界（如实告知用户）

- 伪视觉 ≠ 真多模态：复杂空间关系、真实照片细节、图标样式的描述精度有限
- OCR 仍可能认错非数字 token；数字关键 token（IP/URL/端口/长数字）已由复核通道兜底
- 颜色统计只给占比，无法还原图标/图片细节
- 同一图片重复转换有磁盘缓存（sha256 键），结果一致且秒回
