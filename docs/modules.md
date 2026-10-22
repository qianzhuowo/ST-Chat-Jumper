# 模块架构与扩展指南

## 启动与依赖方向

`index.js` 只导入宿主的 `messageFormatting`、`messageEdit`、`SWIPE_DIRECTION`，注入 `createApplication()` 后启动。浏览器直接运行原生 ES Modules，不需要打包器、第三方运行时或安装 npm 依赖。

```text
index.js → application.js → 功能工厂
                         → state.js → constants.js
功能工厂 → constants.js
```

功能工厂不互相 import，因此没有循环 ESM 依赖。每个文件导出：

- `requiredServices`：显式列出需要的其他功能服务。
- `createFeature({ state, dependencies, hostImports })`：只创建函数并返回服务，不在构造期间触发 DOM、监听、异步任务或其他功能调用。

`application.js` 是唯一组合根：先建立所有工厂，再检查服务重名和缺失，最后冻结服务表。每个工厂得到的 `dependencies` 是只包含该工厂声明服务的只读视图；getter 延迟读取已经链接的服务，不复制函数、不复制可变状态。跨功能回调可以互相调用，但不会形成模块加载环。`services` 是组合内部/测试接口，不是新增的浏览器全局 API。

宿主静态导入只在入口出现，测试可以直接 import 整个组合而不加载酒馆的 `script.js`。宿主专用动态导入仍保留原语义：收藏 regex 引擎使用绝对宿主路径，tt swipe hydration 的相对路径已补足 `src/` 这一层。

## 功能边界

| 文件 | 职责 |
| --- | --- |
| `constants.js` | DOM ID、存储键、默认值、图标/按钮定义；不放实例可变状态 |
| `state.js` | 每次组合创建全新的状态树、Map、Set、token；不注册副作用 |
| `settings.js` | localStorage、extensionSettings 读取、校验、默认合并和持久化 |
| `settings-ui.js` | 扩展设置面板、按钮布局与拖动排序 |
| `host.js` | 宿主上下文/事件名兼容、弹窗、聊天滚动容器、swipe/editor/chat-jump API、宿主样式恢复 |
| `navigation.js` | 视口锚点、楼层跳转、即时滚动、可见楼层观察器、快速翻页 |
| `range.js` | 楼层/区间解析、区间事务、前后翻段、恢复默认视图；守护 tt managed DOM 所有权 |
| `message-content.js` | 消息文本、swipe 分支和当前快照读取 |
| `selection.js` | 选中文字提取、归一化、编辑框文本匹配/偏移映射 |
| `editing.js` | 快速编辑生命周期、高亮定位、外部点击保存、宿主原生删除委托 |
| `actions.js` | 工具栏 action 分派，不放 UI 模板或持久化实现 |
| `toolbar.js` | 工具栏 DOM、位置/缩放/方向/折叠/拖动和按钮绑定 |
| `favorite-store.js` | 收藏元数据格式、迁移、分支/消息匹配、索引、显式/延迟保存 |
| `favorite-preview.js` | 收藏文本格式化、regex、HTML 清理、iframe srcdoc 与消息高度协议 |
| `favorite-manager.js` | 收藏管理器、侧栏、详情页和异步预览渲染 |
| `favorite-panel.js` | 最近收藏列表、快捷菜单、面板位置/尺寸/拖动 |
| `favorite-actions.js` | 收藏备注/确认删除、跳转、点选收藏模式和输入监听 |
| `chat-lifecycle.js` | 聊天切换/消息失效监听、聊天观察兜底和临时状态重置 |
| `lifecycle.js` | 就绪等待、启动、热重载与统一销毁；就绪监听/重试任务也可取消 |
| `utilities.js`、`icons.js` | 提示/时间/数值工具和图标小函数 |

## 状态所有权

状态是实例级的，不是模块级 singleton；重载时不会复用旧 Map、Set、定时器或函数的 `.bound`/`.detach` 属性。

| 分支 | 主要所有者与允许的协作者 |
| --- | --- |
| `layout` | settings 初始化/保存 `settings`；toolbar 修改位置、缩放、折叠与拖动；面板读取布局 |
| `favorites` | store 管理记录/保存队列；preview 管理 regex promise、iframe token 与消息监听标记；manager/panel 管理其界面状态；actions 管理点选模式 |
| `editing` | editing 管理编辑快照、镜像和忙标记 |
| `range` | range 管理激活区间、事务忙标记与操作序号 |
| `navigation` | navigation 管理可见消息集合和 DOM/可见性观察器 |
| `host` | host 管理宿主样式写入/闪烁抑制；favorite-store 管理聊天内容索引，聊天切换时使其失效 |
| `lifecycle` | lifecycle/chat-lifecycle 管理实例、监听卸载函数、聊天引用与轮询；settings-ui 提供设置挂载 observer |

销毁/聊天切换属于跨域边界：允许 lifecycle 清理各分支的监听、observer、定时器和 DOM；允许 chat-lifecycle 重置编辑、导航、区间和收藏临时状态。普通业务修改优先调用拥有该状态的服务，不要直接新增跨域写入。不把 DOM 节点或 chatMetadata 的深拷贝当成新的独立真源。

`settings` 在所有服务链接后调用 `loadSettings()` 初始化，避免默认初始化阶段引用尚未创建的服务。

## 保持的兼容契约

- localStorage：`st_chat_jumper_settings_v1`；extensionSettings：`ST-Chat-Jumper`；chatMetadata：`stcjFavorites`，记录字段不变。
- DOM、CSS class、按钮 action、iframe 协议 `stcj-favorites-preview-v1` 保持原样；`style.css` 未改。
- `window.__ST_CHAT_JUMPER_INSTANCE__` 与 `window.stcjCleanup` 保留；新实例先销毁旧实例；销毁幂等。
- tt managed 虚拟列表只委托单楼导航，绝不由插件重绘区间；静态聊天继续使用宿主 `addOneMessage`。
- Popup 数值返回、取消/空备注、异步保存失败、切换聊天保护与宿主 CSS 恢复语义保留。
- 额外补齐启动早期清理：销毁等待 APP_READY 的实例会取消其监听和等待计时器，防止旧实例在晚到事件后复活。

## 添加功能

1. 先判断现有模块是否应拥有该能力。不要把新实现都塞进 toolbar 或 application。
2. 需要新状态时在 `createState()` 的相应分支添加初值，并明确创建、重置、销毁责任；不要在文件顶层放可变集合/计时器。
3. 将跨功能调用列入 `requiredServices`，通过 `dependencies.name()` 使用；同文件内部调用保持普通函数调用。
4. 新模块在 `application.js` 导入并加入 `features`。工厂只返回服务，实际监听/异步工作在 start/显式操作里进行。
5. 涉及按钮时同时更新 `CONFIGURABLE_BUTTONS`、`BUTTON_DOM_MAP`、工具栏 DOM 和 action 分派；保留已存按钮顺序的合并逻辑。
6. 新监听必须返回卸载函数，或挂到其专属服务的 `.detach`；在统一 teardown 接入。异步 UI 写入必须继续使用操作序号/聊天引用校验。
7. 添加实际 import 模块的行为测试，不用函数源码切片模拟运行时。

## 测试

```sh
npm test
# 等价，不需要 npm install
node --test tests/compatibility.test.cjs tests/instant-navigation.test.cjs tests/modules.test.cjs
```

既有两组回归测试已改为真实模块工厂调用；`module-harness.cjs` 只在功能边界注入 mock，不截取或拼接生产源码。新增测试覆盖完整 ESM 图链接、依赖声明、状态路径、实例隔离、存储兼容、区间解析、早期取消、重复重载清理和宿主样式恢复。

真实宿主冒烟工具：

```sh
node tests/runtime-smoke.cjs 9223 tests/module-tt-results.json --tt
node tests/runtime-smoke.cjs 9224 tests/module-st-results.json
```

它需要可用的 CDP 页面与已就绪的酒馆。tt 模式用 CDP Fetch 在内存中提供工作区 JS，结束后撤销拦截并重载已部署页面，不改宿主文件/扩展安装目录；该模式不是 tt 磁盘部署路径测试。ST 模式在本地真实 HTTP 静态服务器加载原生模块，使用现有本机 Basic Auth 配置但不把凭据写入报告，结束后关闭仅本次启动的独立 headless 浏览器。测试只挂载 UI、打开收藏管理器和重载/销毁，不执行真实聊天编辑、删除或元数据保存。结果文件中的时间戳用于区分本次结果和历史 `tt-*-results.json`。


## 手势轮盘与独立设置

轮盘新增 `radial-config`、`action-registry`、`radial`、`radial-settings` feature；仍使用 `createFeature` 与 `requiredServices`，不引入构建依赖或全局服务查找器。几何/归一化纯函数与实例服务同模块导出，旧测试工厂枚举保持兼容。`toolbar.buildUI` 安装手势，`lifecycle` 销毁手势与 dialog，`chat-lifecycle` 在聊天切换时取消待执行轮盘。`settings-ui` 扩展设置入口只打开独立原生 dialog。

动作 provider 仅经 `registerShortcutAction` 注册，轮盘调用分发服务，不依赖可见悬浮条按钮。[完整契约与参数说明](radial-menu.md)。


### v2 可视化设置与渲染边界

`radial-view.js` 提供原创极坐标扇区几何、共享菜单视图和有效内径计算，设置预览与真实轮盘使用同一实现。`radial-config.js` 管理 v1→v2 迁移、配色 / 每菜单覆盖 / 命名方案归一化；主菜单覆盖提升到唯一全局外观，子菜单可继承或独立。`radial-settings.js` 管理六分区内的配置编辑、方案快照及安全 JSON 导入，其 ResizeObserver 由 `destroyRadialSettings` 清理。设置外观样式在独立原创 `radial.css`，从 `style.css` 顶部导入；TT 内存验证需同时拦截该资源。
