# 川剧详情页中的创意变脸体验

- 上游项目：[FaceOpera](https://github.com/ChenZiHong-Gavin/weekly-vibe-coding/tree/main/apps/peking-opera)，版本 `1579a9592453cd2cc3ac31976a0bedb11d3c90f5`。
- 上游许可证为 Apache License 2.0，见 [LICENSE](LICENSE)。脸谱图像保留原始素材，界面注明这是创意面具，不是川剧传统变脸技法演示。
- 源码位于 `apps/face-opera/`；运行所需的 MediaPipe 0.10.21 WASM、官方人脸和手势模型以及构建产物位于本目录。模型通过官方地址下载后随站点本地发布，浏览器运行时不依赖外部 CDN。
- 改动：摄像头超时和重连处理；识别库、WASM 和模型改为本地加载；人脸识别先启动，手势加载独立；将应用标题改为“川剧 · 创意变脸”。
- 重新构建：在 `apps/face-opera` 执行 `npm ci` 和 `npm run build:site`。构建脚本会更新此目录的界面文件，同时保留已放置的模型与 WASM 文件。
