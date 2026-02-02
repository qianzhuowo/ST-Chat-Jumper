# ST Chat Jumper

一个独立的 SillyTavern 前端插件，提供可拖拽的悬浮跳转条，用于快速跳转聊天楼层。

## 功能

<video src="https://github.com/user-attachments/assets/04cab1ea-01f4-4179-a2bd-625b945f051a.mp4" controls="controls" width="80%" loop></video>

- 快速跳转到**最近 3 楼**：按钮 `1 / 2 / 3`
  - `1` = 最新楼
  - `2` = 倒数第 2 楼
  - `3` = 倒数第 3 楼
- **上一楼 / 下一楼（头部）**：按钮 `<` / `>`（以当前屏幕中最“居中/可见”的消息作为基准）
- **当前楼层对齐**：
  - `H`：跳转到“当前楼层”的**头部**
  - `L`：跳转到“当前楼层”的**尾部**

- **横/竖布局**：按钮 `↔ / ↕` 用于切换
- **收起/展开**：小按钮 `– / +` 可将整条跳转栏收起
- **拖拽**：按住左侧/上方的拖拽手柄（细条）拖动，可移动位置

## 安装方法

- 自动安装
在酒馆的`安装拓展`界面输入以下url：
```
https://github.com/qianzhuowo/ST-Chat-Jumper
```

- 手动安装
把整个`ST Chat Jumper`文件夹放到：
```text
SillyTavern/public/scripts/extensions/third-party/
```
然后在 SillyTavern 的扩展管理里启用该插件。
