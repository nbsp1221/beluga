import { PaneHeader } from '@workspace/ui/components/pane-header';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@workspace/ui/components/resizable';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@workspace/ui/components/sheet';
import { ShellButton } from '@workspace/ui/components/shell-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip';
import { sidebarLinkClassName } from '@workspace/ui/lib/sidebar-link';
import { Clock3, Plug, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router';
import type { Destinations } from '../destinations.js';
import { LayoutContext } from '../layout-context.js';
import {
  SIDEBAR_AUTO_COLLAPSE,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  resolveLayout,
} from './columns.js';
import { Settings } from './settings.js';
import { useMobile, useMobileViewportHeight } from './use-mobile.js';

const mobileNavigationButtonClassName =
  'h-auto min-h-12 min-w-0 flex-1 flex-col gap-1 px-1 py-2 text-xs';
const sidebarPanelId = 'destination-sidebar';
// Layout widths include the divider; the panel library sizes only the content.
const sidebarDividerWidthPx = 1;

export function Workbench({ destinations }: { destinations: Destinations }) {
  const entries = useSyncExternalStore(destinations.subscribe, destinations.getSnapshot);
  const panels = useSyncExternalStore(destinations.subscribe, destinations.getPanels);
  const settings = useSyncExternalStore(destinations.subscribe, destinations.getSettings);

  const location = useLocation();
  const mobile = useMobile();
  const viewportHeight = useMobileViewportHeight(mobile);

  const frameRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const preferredSidebarWidthRef = useRef(SIDEBAR_DEFAULT);
  const sidebarPanelRef = useRef<{
    resize: (size: number) => void;
  } | null>(null);
  const sidebarReturnFocusRef = useRef<HTMLElement | null>(null);
  const panelReturnFocusRef = useRef<HTMLElement | null>(null);
  const restoreSidebarFocusRef = useRef(false);

  const [frameWidth, setFrameWidth] = useState(1024);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [collapsedPreference, setCollapsedPreference] = useState<boolean | undefined>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<string | null>(null);

  const active = entries.find(
    (entry) => location.pathname === entry.path || location.pathname.startsWith(`${entry.path}/`),
  );
  const Sidebar = active?.sidebar?.component;
  const mobileList = mobile && Boolean(Sidebar) && location.pathname === active?.path;
  const mobileDetail = mobile && Boolean(Sidebar) && !mobileList;
  const panel = panels.find((item) => item.id === activePanel);
  const collapsed = collapsedPreference ?? frameWidth < SIDEBAR_AUTO_COLLAPSE;
  const layout = resolveLayout(frameWidth, collapsed, sidebarWidth, Boolean(panel));
  const sidebarVisible = Boolean(Sidebar) && !mobile && !collapsed && !layout.drawer;

  useLayoutEffect(() => {
    // Responsive collapse must not overwrite the user's chosen desktop width.
    const panelWidth = sidebarVisible
      ? preferredSidebarWidthRef.current - sidebarDividerWidthPx
      : 0;
    sidebarPanelRef.current?.resize(panelWidth);
  }, [sidebarVisible]);

  const focusedElement = () =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const toggleSidebar = () => {
    if (!drawerOpen) {
      sidebarReturnFocusRef.current = focusedElement();
    }
    if (layout.drawer) {
      setDrawerOpen((value) => !value);
    } else {
      restoreSidebarFocusRef.current = true;
      setCollapsedPreference(!collapsed);
    }
  };

  const togglePanel = (id: string) => {
    if (activePanel !== id) {
      panelReturnFocusRef.current = focusedElement();
    }
    setActivePanel((current) => (current === id ? null : id));
  };

  const closePanel = () => {
    setActivePanel(null);
    // Modal Sheets restore their own focus after closing; desktop panes do not.
    if (!layout.panelOverlay) {
      panelReturnFocusRef.current?.focus();
    }
  };

  useLayoutEffect(() => {
    if (!restoreSidebarFocusRef.current) {
      return;
    }
    restoreSidebarFocusRef.current = false;
    frameRef.current?.querySelector<HTMLButtonElement>('main [data-sidebar-toggle]')?.focus();
  }, [collapsed]);

  useLayoutEffect(() => {
    if (!frameRef.current) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(0);
      if (entry) {
        setFrameWidth(entry.contentRect.width);
      }
    });
    observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  const panelBody = panel && (
    <div
      className={`flex h-full min-h-0 flex-col bg-background ${mobile ? 'pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]' : ''}`}
    >
      <PaneHeader className="border-b bg-sidebar">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{panel.label}</span>
        <ShellButton label={`Close ${panel.label}`} onClick={closePanel}>
          <X />
        </ShellButton>
      </PaneHeader>
      <panel.component />
    </div>
  );

  return (
    <LayoutContext
      value={{
        mobile,
        viewportHeight,
        collapsed: layout.drawer ? false : collapsed,
        drawer: layout.drawer,
        toggleSidebar,
        closeDrawer: () => setDrawerOpen(false),
        panels,
        activePanel: panel?.id ?? null,
        togglePanel,
      }}
    >
      <a
        href="#main-content"
        className="sr-only fixed top-2 left-2 z-50 rounded-lg bg-popover p-3 focus:not-sr-only"
      >
        Skip to content
      </a>
      <div
        style={{ height: viewportHeight }}
        className="flex h-dvh min-w-0 flex-col overflow-hidden pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] md:flex-row"
      >
        <WorkbenchNavigation
          entries={entries}
          settings={settings}
          mobile={mobile}
          hidden={mobileDetail}
        />
        <div ref={frameRef} className="min-h-0 min-w-0 flex-1">
          <ResizablePanelGroup
            orientation="horizontal"
            onLayoutChanged={(sizes, { isUserInteraction }) => {
              if (!isUserInteraction || !sidebarVisible || !frameRef.current) {
                return;
              }
              const sidebarPercent = sizes[sidebarPanelId] ?? 0;
              if (sidebarPercent === 0) {
                restoreSidebarFocusRef.current = true;
                setCollapsedPreference(true);
              } else {
                const panelAreaWidth = frameRef.current.clientWidth - sidebarDividerWidthPx;
                preferredSidebarWidthRef.current =
                  (sidebarPercent / 100) * panelAreaWidth + sidebarDividerWidthPx;
              }
            }}
          >
            <ResizablePanel
              id={sidebarPanelId}
              panelRef={(panel) => {
                sidebarPanelRef.current = panel;
              }}
              defaultSize={SIDEBAR_DEFAULT - sidebarDividerWidthPx}
              collapsible
              minSize={SIDEBAR_MIN - sidebarDividerWidthPx}
              maxSize={SIDEBAR_MAX - sidebarDividerWidthPx}
              groupResizeBehavior="preserve-pixel-size"
              onResize={({ inPixels }) => {
                if (inPixels > 0) {
                  setSidebarWidth(inPixels + sidebarDividerWidthPx);
                }
              }}
            >
              <div className="h-full overflow-hidden bg-sidebar">
                {Sidebar && sidebarVisible && (
                  <aside className="h-full" aria-label={`${active.label} sidebar`}>
                    <Sidebar />
                  </aside>
                )}
              </div>
            </ResizablePanel>
            {sidebarVisible && <ResizableHandle aria-label="Sidebar width" disableDoubleClick />}
            <ResizablePanel id="workspace-content" minSize={0}>
              <div
                className="grid h-full min-w-0"
                style={{
                  gridTemplateColumns: `minmax(0, 1fr) ${layout.panel}px`,
                }}
              >
                <main
                  id="main-content"
                  ref={mainRef}
                  tabIndex={-1}
                  className="min-h-0 min-w-0 overflow-hidden focus-visible:outline-none"
                >
                  {mobileList && Sidebar && <Sidebar />}
                  <div className="h-full" hidden={mobileList}>
                    <Routes>
                      {entries.map((entry) => (
                        <Route
                          key={entry.id}
                          path={`${entry.path}/*`}
                          element={<entry.component />}
                        />
                      ))}
                      <Route
                        path="*"
                        element={
                          entries[0] ? (
                            <Navigate to={entries[0].path} replace />
                          ) : (
                            <p>No views registered.</p>
                          )
                        }
                      />
                    </Routes>
                  </div>
                </main>
                {panel && !layout.panelOverlay && (
                  <aside className="min-h-0 min-w-0 border-l" aria-label={panel.label}>
                    {panelBody}
                  </aside>
                )}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>
      {Sidebar && (
        <Sheet open={!mobile && layout.drawer && drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent
            side="left"
            showCloseButton={false}
            finalFocus={() => sidebarReturnFocusRef.current}
            className="bg-sidebar data-[side=left]:w-72"
          >
            <SheetTitle className="sr-only">{active.label}</SheetTitle>
            <SheetDescription className="sr-only">{active.sidebar?.description}</SheetDescription>
            <Sidebar />
          </SheetContent>
        </Sheet>
      )}
      <Sheet
        open={Boolean(panel) && layout.panelOverlay}
        onOpenChange={(open) => {
          if (!open) {
            setActivePanel(null);
          }
        }}
      >
        <SheetContent
          showCloseButton={false}
          finalFocus={() => panelReturnFocusRef.current}
          className="data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
        >
          <SheetTitle className="sr-only">{panel?.label ?? 'Context panel'}</SheetTitle>
          <SheetDescription className="sr-only">{panel?.description}</SheetDescription>
          {panelBody}
        </SheetContent>
      </Sheet>
    </LayoutContext>
  );
}

function WorkbenchNavigation({
  entries,
  settings,
  mobile,
  hidden,
}: {
  entries: ReturnType<Destinations['getSnapshot']>;
  settings: ReturnType<Destinations['getSettings']>;
  mobile: boolean;
  hidden: boolean;
}) {
  return (
    <nav
      hidden={hidden}
      className={
        mobile
          ? 'order-last flex shrink-0 items-stretch justify-around gap-1 border-t bg-sidebar px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]'
          : 'flex w-13 shrink-0 flex-col items-center gap-2 overflow-x-hidden overflow-y-auto bg-sidebar p-2 shadow-[inset_-1px_0_0_var(--border)]'
      }
      aria-label="Global navigation"
    >
      {entries.map((entry) => (
        <Tooltip key={entry.id}>
          <TooltipTrigger
            render={
              <NavLink
                to={entry.path}
                aria-label={entry.label}
                className={sidebarLinkClassName(
                  mobile
                    ? 'flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-xs'
                    : 'flex size-9 shrink-0 items-center justify-center rounded-lg',
                )}
              />
            }
          >
            <entry.icon className="size-5" />
            {mobile && <span>{entry.label}</span>}
          </TooltipTrigger>
          {!mobile && <TooltipContent side="right">{entry.label}</TooltipContent>}
        </Tooltip>
      ))}
      <ShellButton
        label="Plugins"
        hintSide={mobile ? undefined : 'right'}
        size="icon-lg"
        aria-disabled="true"
        className={
          mobile
            ? `${mobileNavigationButtonClassName} text-muted-foreground`
            : 'text-muted-foreground'
        }
      >
        <Plug className="size-5" />
        {mobile && <span>Plugins</span>}
      </ShellButton>
      <ShellButton
        label="Automation"
        hintSide={mobile ? undefined : 'right'}
        size="icon-lg"
        aria-disabled="true"
        className={
          mobile
            ? `${mobileNavigationButtonClassName} text-muted-foreground`
            : 'text-muted-foreground'
        }
      >
        <Clock3 className="size-5" />
        {mobile && <span>Automation</span>}
      </ShellButton>
      {!mobile && <div className="flex-1" />}
      <Settings
        sections={settings}
        mobile={mobile}
        triggerClassName={mobile ? mobileNavigationButtonClassName : undefined}
      />
    </nav>
  );
}
