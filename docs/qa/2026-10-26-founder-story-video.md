# 创始人口播独立视频页

用户于2026-10-26授权在 https://www.drinkingtime.top 下新增路由公开剪映「10月26日」口播视频。成片来源为用户桌面导出文件，81.25秒、1920×1080、含原声。

路径：`/founder-story/`。权威源文件：`client/public/founder-story/`。使用现有 Express 静态服务；不修改首页、鉴权、业务数据或配置，不重启 PM2。只部署本目录至既有生产目录的 `client/public` 与 `dist/public`，不发布主仓其他未提交内容。

可重复验证：

```sh
curl -fsS https://www.drinkingtime.top/founder-story/ -o /tmp/founder-story-live.html
cmp client/public/founder-story/index.html /tmp/founder-story-live.html
curl -fsS -r 0-1023 -D /tmp/founder-video-headers.txt https://www.drinkingtime.top/founder-story/founder-20261026.mp4 -o /tmp/founder-video-range.bin
ffprobe -v error -show_entries format=duration,size:stream=codec_name,codec_type,width,height -of json client/public/founder-story/founder-20261026.mp4
pnpm feature:validate
```

上线验证通过：页面与源文件逐字节一致，MP4范围请求返回206且1024字节，三文件上传SHA256均匹配。Chrome readyState=4、1920×1080、81.246秒，点击后实际播放至20.5秒，没有媒体错误或横向溢出；截图 /private/tmp/shiguang-founder-video-live.jpg。PM2 PID477004保持不变，healthz正常。真机Safari、微信内置浏览器未验收。此次静态增量已在生产client/public与dist/public各保存一份；本地新增源文件与功能卡保留，未提交或发布其他会话的主仓修改。原始成片不改写；网页采用H.264/AAC及faststart，controls/playsinline，不自动播放，完整取景。

后续按用户要求删除页面标题与页脚标语，同时清理title及description中的对应文字；仅同步HTML，线上与本地文件一致，视频与封面不变。


## 2026-10-27 底部信息遮罩

按用户要求用40像素高深色遮罩覆盖视频底部姓名、人数和录制时间；写入媒体本身，封面和下载链接同步更新。新文件 founder-20261026-masked.mp4、poster-masked.jpg。原文件保留便于恢复。ffprobe确认1920×1080、81.246秒，AAC原音轨直接复制。封面目视确认遮罩覆盖信息；线上HTML与本地一致，上传视频SHA256一致，HTTP Range 206。仅部署静态素材与独立HTML，PM2 PID 479396未变。


## 2026-10-28 新视频

按用户要求替换为桌面导出的10月28日成片，底部40像素遮挡姓名、人数、时间；封面为遮挡后视频最后一帧。保留原音轨与101.819501秒时长，分辨率1920×1080。线上页面与本地一致，媒体文件SHA256一致，视频HTTP Range 206；未重启服务。手机真机播放待验证。
