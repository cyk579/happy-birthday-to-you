# Birthday Cake - Interactive Gift

一个可以直接部署到 GitHub Pages 的生日蛋糕互动网页。开场是一封星光邀请：银蓝与暖玫瑰色的星尘缓缓流动，本地字体与精简排版呈现生日祝福。点击「开启生日礼物」后，星尘散开，在同一个 Three.js 场景里逐渐显现没有底盘的两层粒子蛋糕。蛋糕与蜡烛持续缓慢旋转，微粒、光晕和火焰保持细微的动态。

吹气交互由 Web Audio API 驱动。页面会在获得麦克风权限后分析气息强度，吹气越强，蜡烛火焰越弱；达到阈值后火焰熄灭，场景保留烟雾与粒子反馈，不显示独立的祝福弹层。无法使用麦克风时，可以在场景空白处长按约 0.9 秒触发备用熄灭入口。

进入蛋糕场景后，原创配乐 **Starlight — A Little Celebration** 淡入：104 BPM、64 小节，约 2 分 28 秒，以明亮的钢琴旋律、切分和弦和有弹性的合成低音，配合轻底鼓、拍手与沙锤，营造轻快的庆祝气氛，没有引用传统生日歌曲调。音轨位于 `assets/starlight-piano.mp3`，音尾衔接曲首以供循环播放。音乐默认低音量；请求或开启麦克风时自动淡出，避免干扰吹气检测，关闭麦克风或熄灭后缓缓恢复。手动静音始终优先。

## 项目结构

- `index.html`：页面入口与交互控件。
- `main.js`：应用状态、渲染循环、输入事件和响应式尺寸处理。
- `nebula-scene.js`：纯粒子蛋糕、蜡烛、光晕和星尘场景。
- `audio.js`：Web Audio API 音乐控制、麦克风分析和吹气检测。
- `music.js`：本地音轨加载、解码、循环与音量过渡。
- `hand-tracking.js`：摄像头权限、帧采集和识别 Worker 的生命周期。
- `gesture-worker.js`：在独立 Web Worker 中运行 MediaPipe 手部与手势识别。
- `gesture-controls.js`：张掌摆手旋转、捏合拖动、保持 V 翻转与握拳复位的交互状态。
- `styles.css`：界面排版、控件和入场过渡。
- `vendor/mediapipe/`：固定版本的官方 MediaPipe Tasks Vision SDK、WASM 运行时和许可证。
- `assets/`：本地字体、图标、背景音乐、`models/gesture_recognizer.task` 手势模型及相应许可证，部署时需要一起上传。
- `THIRD-PARTY.md`：MediaPipe 资源版本、来源、许可依据和校验值。
- `scripts/render_music.py`：钢琴编曲、低音与打击乐合成、离线渲染脚本；仅重新制作音轨时需要 Python、NumPy 和 FFmpeg。

## 本地预览

浏览器的麦克风和摄像头权限要求安全上下文。可以使用任意静态服务器预览，例如：

```bash
npx serve .
```

然后打开终端显示的本地地址。请通过静态服务器预览；直接双击 `index.html` 使用的 `file://` 地址可能被浏览器限制 ES 模块、Worker、模型加载及麦克风/摄像头访问。分享给收礼人的 GitHub Pages 链接不需要安装任何软件。

## GitHub Pages 部署

1. 在 GitHub 新建仓库，例如 `birthday-cake`。
2. 将项目代码与资源上传到仓库根目录，保持目录层级；必须包含 `gesture-worker.js`、完整的 `vendor/mediapipe/` 和 `assets/models/`，以及原有音乐、字体等资源。原始参考视频、个人截图与 `artifacts/` 验证文件不用于部署，已在 `.gitignore` 中排除。
3. 打开仓库的 **Settings -> Pages**，将 Source 设为 **Deploy from a branch**，选择 `main` 分支与 `/ (root)`。
4. 等待 GitHub Pages 完成构建，访问 `https://<你的用户名>.github.io/birthday-cake/`。

页面使用 Three.js 的 jsDelivr CDN，不需要安装运行时或构建步骤。手势识别使用项目内的官方 MediaPipe SDK 和模型，部署后从同一网站加载，无需再访问外部模型服务器。代码中的脚本、样式和模块引用使用相对路径，因此部署到仓库子路径时仍可加载。生产部署请使用 HTTPS，这样移动端浏览器才能正常请求麦克风和摄像头权限。

手势资源按需加载，首次点击摄像头按钮时约需下载 18 MB 的模型与一套 WASM 运行时；其中模型包约 8.37 MB。`vendor/mediapipe/wasm/` 保留 SIMD 与兼容回退两套文件，浏览器只选择一套加载。完整手势资源约 28 MB，上传时请保留两套，后续访问可利用浏览器缓存。

## 交互说明

- 首次点击入口会启动蛋糕场景和钢琴配乐；麦克风由右上角按钮单独开启。
- 顶部右侧按钮分别控制音乐、麦克风与摄像头手势。音乐加载失败可通过声音按钮重试，视觉场景与麦克风仍可使用。
- 麦克风权限被拒绝时，页面仍可体验全部视觉动画；在场景空白处长按约 0.9 秒即可使用备用熄灭入口。
- `prefers-reduced-motion` 开启时会自动降低过渡动画。

## 摄像头手势

进入蛋糕场景后，点击右上角的相机按钮并允许摄像头访问。识别资源准备好后，把一只手放到镜头前，面板会显示预览、手部关键点和操作进度。开启手势期间暂停蛋糕的自动旋转，方便控制视角。

- **张掌摆手**：张开五指、掌心朝向镜头，左右摆手即可让蛋糕跟随旋转，上下移动控制俯仰，无需捏合手指。手掌停下时蛋糕停止转动；把手移出镜头即可结束控制。
- **捏合移动**：也可以捏合拇指与食指后移动，控制旋转与俯仰；松开并收起手掌即可停止拖动。
- **V 手势翻转**：保持 V 手势直到进度填满，识别稳定时约 0.65 秒，蛋糕会翻转 180°。松开后再次保持 V，可翻回正面。
- **握拳复位**：保持握拳直到进度填满，识别稳定时约 0.8 秒，恢复正立的初始视角。面板也提供「翻转」和「复位」按钮。
- **关闭手势**：再次点击相机按钮或面板右上角的关闭按钮，摄像头立即停止采集；蛋糕逐渐恢复正立并继续自动旋转。切换到其他标签页也会关闭摄像头，返回后需手动重新开启。

摄像头帧只在浏览器本地处理，不录制、不上传。主线程负责采集和界面反馈，独立 Web Worker 执行 MediaPipe 识别；最多约每秒处理 15 帧，同时只保留一帧待识别，蛋糕渲染循环独立运行。请使用支持 Web Worker、`createImageBitmap` 和 `OffscreenCanvas` 的浏览器，例如新版 Chrome 或 Edge；不支持或权限被拒绝时，音乐、视觉场景与原有吹气入口仍可使用。

## 设计参考

- [Cartier / Lovelace](https://www.lovelace.paris/projects/cartier)：衬线排版、声音与连续场景切换。
- [Lusion](https://lusion.co/)：实时三维场景、指针反馈与动效节奏。
- [collidingScopes / 3d-model-playground](https://github.com/collidingScopes/3d-model-playground)：借鉴摄像头手势操控三维物体的交互思路；本项目按蛋糕场景编写控制逻辑。
- [MediaPipe Gesture Recognizer 官方指南](https://ai.google.dev/edge/mediapipe/solutions/vision/gesture_recognizer/web_js)：使用官方 Tasks Vision SDK 和预训练模型完成手部关键点与手势识别，资源及许可见 [THIRD-PARTY.md](THIRD-PARTY.md)。

网页中的星尘和蛋糕均由代码生成，未使用参考案例的图像或模型。字体采用 Noto Serif SC 和 Cormorant Garamond，图标采用 Lucide；许可证位于 `assets/`。

背景音乐由本项目单独编曲，使用 Alexander Holm 的 Salamander Grand Piano 钢琴单音采样（CC BY 3.0）；低音、底鼓、拍手和沙锤均由脚本合成，没有使用外部鼓采样。音轨、采样来源与处理说明见 [音乐署名](assets/MUSIC-CREDITS.md)；部署与分享时请保留署名和许可文件。
