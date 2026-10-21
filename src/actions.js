import * as constants from './constants.js';

// Explicit cross-feature service contract; linked once by application.js.
export const requiredServices = [
  "alignCurrentMessage",
  "getAnchorMesId",
  "getLastMessageId",
  "handleQuickEditAction",
  "jumpToMessage",
  "openFavoritesManager",
  "quickFlipLatestMessagePage",
  "requestNativeMessageDelete",
  "restoreDefaultRangeView",
  "setFavPanelOpen",
  "shiftFloorRange",
  "showFloorRange",
  "toggleCollapse",
  "toggleOrientation",
  "togglePinMode"
];

export function createFeature({ state, dependencies }) {
  async function handleAction(action) {
    const lastId = dependencies.getLastMessageId();

    switch (action) {
      // 最近 3 楼：统一跳到“头部”
      case 'recent3':
        return dependencies.jumpToMessage(lastId - 2, 'start');
      case 'recent2':
        return dependencies.jumpToMessage(lastId - 1, 'start');
      case 'recent1':
        return dependencies.jumpToMessage(lastId, 'start');
      case 'quickPage':
        return dependencies.quickFlipLatestMessagePage('right');
      case 'quickPageLeft':
        return dependencies.quickFlipLatestMessagePage('left');

      // 收起/展开
      case 'toggleCollapse':
        dependencies.toggleCollapse();
        return;

      // 楼层区间显示 / 恢复默认
      case 'showRange':
        return dependencies.showFloorRange();
      case 'rangePrev':
        return dependencies.shiftFloorRange('prev');
      case 'rangeNext':
        return dependencies.shiftFloorRange('next');
      case 'resetRange':
        return dependencies.restoreDefaultRangeView();
      case 'editRange':
        return dependencies.showFloorRange();

      // 布局切换
      case 'toggleOrientation':
        dependencies.toggleOrientation();
        return;

      // 收藏：打开面板并进入点选
      case 'togglePin':
        dependencies.togglePinMode();
        return;

      case 'openFavoritesManager':
        dependencies.openFavoritesManager();
        return;

      // 最近收藏：展开/收起
      case 'toggleFavPanel':
        dependencies.setFavPanelOpen(!state.favorites.favPanelOpen);
        return;

      // 上一楼/下一楼：跳到“头部”
      case 'prev': {
        const anchor = dependencies.getAnchorMesId();
        return dependencies.jumpToMessage(anchor - 1, 'start');
      }
      case 'next': {
        const anchor = dependencies.getAnchorMesId();
        return dependencies.jumpToMessage(anchor + 1, 'start');
      }

      // H/L：对齐“当前楼层”的头部/尾部
      case 'currentHead':
        return dependencies.alignCurrentMessage('start');
      case 'currentTail':
        return dependencies.alignCurrentMessage('end');

      // ✏️ 快速编辑（选中内容可高亮定位）
      case 'quickEdit':
        return dependencies.handleQuickEditAction();
      case 'quickDelete':
        return dependencies.requestNativeMessageDelete();

      default:
        return;
    }
  }

  return { handleAction };
}
