# 戏台开场演示

预览入口：`/#theater-demo`。地图中的京剧（Ⅳ-28）、黄梅戏（Ⅳ-60）、昆曲（Ⅳ-1）详情共用这套戏台和开幕动画，每个剧种只显示一个节目。当前使用浏览器原生视频控件，无需额外安装播放器或 App。京剧播放用户提供的《铡美案》片段，黄梅戏播放用户提供的《女驸马》片段，昆曲播放用户提供的《牡丹亭》片段。

视频文件：`jingju-zha-mei-an.mp4`、`huangmei-nv-fuma.mp4`、`kunqu-mu-dan-ting.mp4`。京剧视频由用户提供的 HEVC 原片转为 H.264/AAC，以便在常见浏览器播放；昆曲视频沿用用户提供的 H.264 原片。后续视频接入：在 `src/theaterConfig.ts` 对应剧目中填写 `videoUrl`，支持项目内视频路径或可直接播放的 HTTPS 视频地址。

剧种和推荐戏单资料来源：
- 京剧：https://www.ihchina.cn/project_details/13201/
- 黄梅戏：https://www.ihchina.cn/project_details/13280.html 、https://www.ihchina.cn/project_details/23673.html
- 昆曲：https://www.ihchina.cn/project_details/13133.html

## 图片

- `stage.png`：基于用户提供的戏台参考图，经内置 image_gen 工具编辑，移除演员、幕布和界面，保留建筑、灯笼及空台口。
- `opera-poster.png`：内置 image_gen 生成的京剧人物创意示意，不是真人录制，不作为准确剧目、服饰或身段资料。

## 提示词

戏台：Edit the supplied Chinese opera stage reference into a clean production website background asset. Keep the same frontal traditional Chinese pavilion opera stage, blue tiled roof, amber carved wooden frame, plaque reading 中国戏曲, lanterns, glowing warm lighting, wooden floor and steps, flowers near edges, cinematic realistic wood and brass. Remove all performers, video playback controls, play icon, text information panel and all other UI. Remove the red side curtains entirely; expose clean wooden columns and the entire dark rectangular stage opening. The stage opening must be a clean empty nearly black warm brown recess, suitable for placing a real video on top. Keep decorative carving outside that opening; no furnishings or people inside it. Wide 16:9 composition, straight-on, symmetric, photorealistic highly detailed materials, no watermark. No UI except the physical plaque 中国戏曲.

海报：Generate a wide cinematic 16:9 Chinese opera performance still for a website video placeholder. A single adult Peking opera dan performer in ornate imperial red and ivory embroidered costume, elaborate jeweled headdress, precise elegant water sleeve gesture, graceful dignified face with traditional opera makeup, full body visible centered. Traditional painted palace garden backdrop, warm amber stage light, muted deep warm red and soft blue palette, photorealistic richly detailed fabric. An artistic opera illustration, not a real person. No wooden theater frame, foreground curtains, roof, UI, text, play button or watermark. Wide composition with breathing room around figure. No claim to depict historically exact choreography or a real recording.

幕布为独立 CSS 图层：点击开戏时灯光渐亮、幕布拉开。重看开场会暂停视频并重新合幕。
