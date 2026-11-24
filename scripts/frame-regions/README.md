# 在其他项目中定位图片里的物体

服务端可以直接调用此目录的离线 worker。安装 `requirements.txt` 中的依赖，准备完整的 CLIPSeg 权重、配置和分词文件。同一台机器上的多个项目可以共用只读模型目录。通用定位使用 CPU，只需 CLIPSeg。

向 `worker.py` 的标准输入传入一条 JSON。下面的文件路径需要换成项目实际路径。为缓存使用应用专用的私有目录，`scope` 由调用方根据当前账号和项目确定。

```sh
python3 scripts/frame-regions/worker.py <<'JSON'
{
  "operation": "locate",
  "modelPath": "/srv/models/clipseg",
  "source": "/srv/example/frame.png",
  "cachePath": "/srv/example/private-cache/frame-regions",
  "scope": "example-account/example-project",
  "prompts": ["paper airplane", "tree foliage"]
}
JSON
```

每次可传 1 至 8 个短语。优先使用英文物体名。输出的 `result` 与输入短语一一对应，每个短语最多返回三个候选框。坐标依次为左、上、右、下，占图像宽高的比例。空数组表示本次未能可靠定位。相邻人物可能落入同一候选框，具体人数、身份和动作需要结合分镜核对。

在本产品的书页和视频试图中，选择本镜图片即可使用。用户可以改识别目标，也可以先看候选框。服务端检查素材归属，按账号、作品、图片内容、模型和目标复用结果。使用其他应用调用时，先校验当前用户对输入图片的读取权限，再将文件交给 worker。
