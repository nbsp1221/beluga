export const SIDEBAR_DEFAULT = 280;
export const SIDEBAR_MIN = 264;
export const SIDEBAR_MAX = 420;
export const SIDEBAR_AUTO_COLLAPSE = 1024;
export const SIDEBAR_DRAWER_BREAKPOINT = 768;

const minimumContentWidth = 400;
const minimumPanelWidth = 300;
const maximumPanelShare = 0.45;

export function resolveLayout(
  width: number,
  collapsed: boolean,
  requestedSidebar: number,
  panelOpen: boolean,
) {
  const drawer = width < SIDEBAR_DRAWER_BREAKPOINT;
  const sidebar =
    drawer || collapsed ? 0 : Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, requestedSidebar));

  const contentWidth = width - sidebar;
  const panelOverlay = contentWidth < minimumContentWidth + minimumPanelWidth;
  const panel =
    !panelOpen || panelOverlay
      ? 0
      : Math.min(width * maximumPanelShare, contentWidth - minimumContentWidth);

  return { drawer, sidebar, panel, panelOverlay };
}
