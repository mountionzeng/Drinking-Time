# Desktop video export check — 2026-10-19

## Change

Moved the existing ExportButton from global TopBar account actions to the video workspace toolbar. Text/image workspaces no longer display it. Story-switch guard, endpoint, source fallback and encoding behavior unchanged. Mobile unchanged. Not deployed.

## Real browser / local FFmpeg checks

- localhost:3000/editing, current authenticated account; clicked actual video-workspace export button twice. No paid generation or new source media.
- Story 1207: export-1207-1792381951448.mp4, H.264/AAC, 1920x1080, 24 seconds, 86,688 bytes. ffmpeg blackdetect confirms effectively entire video black. Existing story lacks video clips; static image shown in UI does not enter this exporter.
- Story 1172: export-1172-1792382063663.mp4, H.264/AAC, 1080x1080, 9 seconds, 2,702,962 bytes. Browser video readyState=4, no media error, played through currentTime=9. First six seconds have video; last three seconds black. Audio volume -91 dB (silent).
- Files remain under .webdev/videos/. No source story/clip edits were made.
- Screenshot: /tmp/export-button-video-workspace.png.

## Limits / next decision

Successful file encoding is not complete-content acceptance. Existing relaxed export fills missing segments with equal-length black frames; image layers and image text overlays have known export gaps. Default fallbackToLatestTake=true can use a fallback video. Need agree on export scope and missing-material handling before changing these semantics.

## Automated checks

- TypeScript check passed.
- videoExport and timelineMediaExport: 24 tests passed.
- editingStudioWorkspace regression passed (see local test output).

## Follow-up implementation after user confirmation

The earlier outputs above describe the OLD exporter, not acceptance of the changes below.

- Export now defaults to strict missing-source rejection, and the desktop button sends fallbackToLatestTake=false.
- Current images and independent timeline image clips are encoded at their timeline durations, using shared visual winner selection, cover framing, rotation, scale, flips and per-image transforms.
- Intentional gaps still occupy their original duration. Missing images/videos cause an error rather than silent black replacement.
- Authorized local images only (32MB / 40MP bound); remote-only images currently produce an actionable error.
- Custom image text layers are not supported yet; export explicitly rejects them instead of dropping text. Timeline subtitles remain supported.
- Isolated FFmpeg integration creates a blue video with tone, a red still image, a 0.5-second intentional gap and a caption. Actual output verified: 2.5 seconds, video/audio streams, blue/red/black pixels at expected times, visible white caption pixels, nonzero audio samples. Persistence mocked; no business story edits.
- Four export test files: 32 tests passed sequentially (a parallel run encountered an existing 10-second import hook timeout; sequential rerun passed).
- Browser follow-up: fresh local tab, video workspace, real Export click on story1207 returned “有 1 段缺少素材，严格模式不出半成品：镜头 1 没有可用的当前视频或图片”. Added a persistent inline alert scoped to the exporting story, so the error remains readable after the toast expires. Screenshot: /tmp/export-strict-validation.png. Video-workspace button visible; no source story edits.
