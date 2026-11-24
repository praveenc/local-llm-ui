'use client';

import { Menu, Moon, PanelLeftClose, PanelLeftOpen, Sun } from 'lucide-react';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
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
  /** Shown under the product name, for example "Ollama · llama3.2"; nothing when unset */
  scope?: string;
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
  scope,
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
              <SidebarBrand scope={scope} />
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
            <SidebarBrand scope={scope} />
          </div>
          {/* Sidebar Content */}
          <div className="flex-1 overflow-y-auto">{navigation}</div>
        </SheetContent>
      </Sheet>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
          <div className="flex min-w-0 items-center gap-2">
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
            <h1 className="truncate text-[15px] font-semibold text-foreground" title={title}>
              {title}
            </h1>
          </div>
          <div className="flex items-center gap-1">
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

function SidebarBrand({ scope }: { scope?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <ProductMark className="size-7 shrink-0 text-primary" />
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-semibold text-sidebar-foreground">Local LLM UI</span>
        {scope && (
          <span className="truncate text-xs text-muted-foreground" title={scope}>
            {scope}
          </span>
        )}
      </div>
    </div>
  );
}
