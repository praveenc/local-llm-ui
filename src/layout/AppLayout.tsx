'use client';

import { Menu, Moon, PanelLeftClose, PanelLeftOpen, Pencil, SquarePen, Sun } from 'lucide-react';

import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { EditableTitleInput, type TitleEditEnd } from '@/components/ui/editable-title-input';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { ColorTheme, ResolvedVisualMode } from '@/utils/colorThemes';
import type { VisualMode } from '@/utils/preferences';

import { ProductMark } from './ProductMark';
import { ThemeMenu } from './ThemeMenu';

interface AppLayoutProps {
  navigation: React.ReactNode;
  children: React.ReactNode;
  /** Title of the open conversation; the header h1 */
  title?: string;
  /**
   * Saves a new title for the open conversation; the header title becomes editable when this
   * is set. Leave it out when no conversation is stored (a new chat has no title to rename).
   */
  onRenameTitle?: (title: string) => Promise<void> | void;
  /** Starts a new chat; the header button shows when this is set */
  onNewChat?: () => void;
  navigationOpen?: boolean;
  onNavigationChange?: (open: boolean) => void;
  /** Stored mode, shown in the theme menu: system, light, or dark */
  visualMode: VisualMode;
  /** Scheme drawn now; the header toggle and the toasts follow it */
  theme: ResolvedVisualMode;
  onToggleTheme: () => void;
  colorTheme: ColorTheme;
  onColorThemeChange: (value: ColorTheme) => void;
  onVisualModeChange: (value: VisualMode) => void;
}

export function AppLayout({
  navigation,
  children,
  title = 'New conversation',
  onRenameTitle,
  onNewChat,
  navigationOpen = true,
  onNavigationChange,
  visualMode,
  theme,
  onToggleTheme,
  colorTheme,
  onColorThemeChange,
  onVisualModeChange,
}: AppLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const renameButtonRef = useRef<HTMLButtonElement>(null);
  // Set when a key ends the edit, so focus goes back to the pencil. A click elsewhere keeps its focus.
  const restoreFocusRef = useRef(false);

  // Without a stored conversation there is nothing to rename; drop an edit left open
  if (renaming && !onRenameTitle) setRenaming(false);

  useEffect(() => {
    if (!renaming && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      renameButtonRef.current?.focus();
    }
  }, [renaming]);

  const endRename = (reason: TitleEditEnd) => {
    restoreFocusRef.current = reason !== 'blur';
    setRenaming(false);
  };

  // Use the prop directly - this is a controlled component
  const sidebarOpen = navigationOpen;

  const toggleSidebar = () => {
    onNavigationChange?.(!sidebarOpen);
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Desktop Sidebar, from 1024 px; narrower screens use the sheet */}
      <aside
        className={cn(
          'hidden lg:flex lg:flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-300 ease-in-out motion-reduce:transition-none',
          sidebarOpen ? 'w-72' : 'w-0'
        )}
      >
        {sidebarOpen && (
          <>
            {/* Sidebar Header */}
            <div className="border-b border-sidebar-border px-4 py-3">
              <SidebarBrand />
            </div>
            {/* Sidebar Content */}
            <div className="flex-1 overflow-y-auto">{navigation}</div>
          </>
        )}
      </aside>

      {/* Mobile Sidebar (Sheet) */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0 bg-sidebar" aria-describedby={undefined}>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {/* Sidebar Header; SheetContent draws the close button */}
          <div className="border-b border-sidebar-border px-4 py-3 pr-12">
            <SidebarBrand />
          </div>
          {/* Sidebar Content */}
          <div className="flex-1 overflow-y-auto">{navigation}</div>
        </SheetContent>
      </Sheet>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {/* Mobile menu button */}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden size-11"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </Button>
            {/* Desktop toggle button */}
            <Button
              variant="ghost"
              size="icon"
              className="hidden lg:flex h-8 w-8"
              onClick={toggleSidebar}
              aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
              aria-expanded={sidebarOpen}
              title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
            >
              {sidebarOpen ? (
                <PanelLeftClose className="h-5 w-5" />
              ) : (
                <PanelLeftOpen className="h-5 w-5" />
              )}
            </Button>
            {onRenameTitle && renaming ? (
              <EditableTitleInput
                value={title}
                onSave={onRenameTitle}
                onEnd={endRename}
                aria-label="Chat title"
                className="h-8 flex-1 px-2 text-[15px] font-semibold md:text-[15px]"
              />
            ) : onRenameTitle ? (
              <div className="group/title flex min-w-0 items-center">
                {/* A click edits the title. The pencil next to it is the keyboard and screen reader path. */}
                <h1
                  className="min-w-0 cursor-text truncate text-[15px] font-semibold text-foreground"
                  title={title}
                  onClick={() => setRenaming(true)}
                >
                  {title}
                </h1>
                <Button
                  ref={renameButtonRef}
                  variant="ghost"
                  size="icon"
                  className="ml-1 size-11 shrink-0 opacity-0 transition-opacity group-hover/title:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 md:size-8 motion-reduce:transition-none"
                  onClick={() => setRenaming(true)}
                  aria-label="Rename chat"
                >
                  <Pencil className="size-4" />
                </Button>
              </div>
            ) : (
              <h1 className="truncate text-[15px] font-semibold text-foreground" title={title}>
                {title}
              </h1>
            )}
          </div>
          <div className="flex items-center gap-1">
            {onNewChat && (
              <Button
                variant="ghost"
                size="icon"
                className="size-11 md:size-9"
                onClick={onNewChat}
                aria-label="New chat"
                title="New chat"
              >
                <SquarePen className="h-5 w-5" />
              </Button>
            )}
            <ThemeMenu
              colorTheme={colorTheme}
              visualMode={visualMode}
              resolvedVisualMode={theme}
              onColorThemeChange={onColorThemeChange}
              onVisualModeChange={onVisualModeChange}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-11 md:size-9"
              onClick={onToggleTheme}
              aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
              title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            >
              {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
            </Button>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
      </div>

      {/* Toast Notifications */}
      <Toaster theme={theme} />
    </div>
  );
}

function SidebarBrand() {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <ProductMark className="size-7 shrink-0 text-primary" />
      <span className="text-sm font-semibold text-sidebar-foreground">Local LLM UI</span>
    </div>
  );
}
