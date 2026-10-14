# 古筝专题素材说明

- `scene-study.png`、`cover-landscape.png`：用户提供的 AI 创意素材，来自“乡野非遗地图_古筝播放器_Codex交付包”。场景仅使用上部裁切，避开原图的古琴。
- `instrument-transparent.png`：以用户提供的 `instrument-guzheng.png` 为输入，通过内置 ImageGen 生成透明背景版本。保留原器物视角与画面位置；不代表馆藏、真实实物或完整调弦示意。
- 四首精选录音由用户提供，作为静态音频接入专题；文件对应关系见下表。未提供演奏者信息，不推断署名。额外选择的本地文件通过浏览器 Object URL 播放，页面关闭时释放，未上传服务器。
- 琴弦声音由 Web Audio AudioWorklet 运行丝竹三韵的古筝物理模型合成，标为合成示意音色；来源和授权记录见 `../../classical-music/ATTRIBUTION.md`。七个音高为 D4、E4、F♯4、A4、B4、D5、E5，以 A4 = 440 Hz 计算；不表示照片中各弦的实际定弦。

## 资料依据

- 山东古筝乐：https://www.ihchina.cn/project_details/12692.html
- 中州筝派：https://www.ihchina.cn/project_details/12693/
- D 调五声音阶：https://beibeizheng.com/guzheng/

核对日期：2026-10-11。简介为简短概述，代表曲目仅使用官方介绍列出的名称；没有附带录音时不显示演奏者和虚构时长。

## 图像处理记录

内置 ImageGen 提示词：Extract this exact guzheng and its wooden stand and red tassel onto a truly transparent background. Remove only the off-white background and floor shadow. Preserve the original 1536x1024 composition, full object, positions, camera perspective, every string, colors, details, and scale exactly as supplied; do not redesign or move the instrument. This is a website cutout with an aligned SVG string overlay, so preserving geometry matters.

## 第二版视觉素材（2026-10-11）

- `listening-room-v2.png`：内置 ImageGen 参照用户页面效果图生成，仅保留书房、古筝、器物和纸本山水，不含界面文字或控件。播放器和导航由代码实现。
- `title-guzheng-v2.png`：内置 ImageGen 参照用户“古琴雅韵非遗典藏排版.png”生成透明书法标题。按用户明确选择改为“古筝雅韵”，保留国韵印章；正文仍为古筝项目资料。

背景提示词：Use supplied webpage mockup as reference to create ONLY artwork background. Wide 1920x1080. Remove all text, logos, navigation, buttons, controls, progress bars, cards, footer and icons. Left 62% sunlit Chinese study with one guzheng on tabletop, incense, vase and books; right 38% empty cream rice paper with faint ink landscape. Soft blend, no hard divider, no people or additional instruments.

标题提示词：Create a clean transparent-background calligraphic website title derived from reference. Keep expressive dark warm brown brush style. Text exactly 古筝雅韵 replacing 琴 with 筝, and a vermilion 国韵 seal on the right. Output only the horizontal four-character title and seal. Remove paragraphs, subtitle and tall left gold border. No background, shadows or UI. Preserve accurate bamboo radical.

精选曲目展示按用户提供的列表调整为：高山流水、春江花月夜、汉宫秋月、梅花三弄。该展示列表不作为具体地区流派的官方曲目清单。

## 用户提供的录音（2026-10-11）

按用户附件顺序对应曲目。保留原始文件内容，仅重命名；时长取自浏览器媒体元数据，播放时再次读取。

| 曲目 | 用户原文件 | 页面文件 | 时长 |
| --- | --- | --- | --- |
| 高山流水 | M500003zJG390yncGi.mp3 | audio/gaoshan-liushui.mp3 | 03:41 |
| 春江花月夜 | 4152760884.aac | audio/chunjiang-huayueye.aac | 01:36 |
| 汉宫秋月 | M50000442WLa2K4KoF.mp3 | audio/hangong-qiuyue.mp3 | 04:10 |
| 梅花三弄 | 3966303132.aac | audio/meihua-sannong.aac | 04:53 |
