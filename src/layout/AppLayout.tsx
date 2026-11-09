'use client';

import { Menu, Moon, PanelLeftClose, PanelLeftOpen, Sun, X } from 'lucide-react';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { ColorTheme } from '@/utils/colorThemes';
import type { VisualMode } from '@/utils/preferences';

import { ThemeMenu } from './ThemeMenu';

interface AppLayoutProps {
  navigation: React.ReactNode;
  children: React.ReactNode;
  navigationOpen?: boolean;
  onNavigationChange?: (open: boolean) => void;
  theme: VisualMode;
  onToggleTheme: () => void;
  colorTheme: ColorTheme;
  onColorThemeChange: (value: ColorTheme) => void;
  onVisualModeChange: (value: VisualMode) => void;
}

export function AppLayout({
  navigation,
  children,
  navigationOpen = true,
  onNavigationChange,
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
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden md:flex md:flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300 ease-in-out',
          sidebarOpen ? 'w-72' : 'w-0'
        )}
      >
        {sidebarOpen && (
          <>
            {/* Sidebar Header */}
            <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <span className="text-sm font-bold">L</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-sidebar-foreground">
                    Local LLM UI
                  </span>
                  <span className="text-xs text-sidebar-foreground/60">Chat Interface</span>
                </div>
              </div>
            </div>
            {/* Sidebar Content */}
            <div className="flex-1 overflow-y-auto">{navigation}</div>
          </>
        )}
      </aside>

      {/* Mobile Sidebar (Sheet) */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0 bg-sidebar">
          {/* Sidebar Header */}
          <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <span className="text-sm font-bold">L</span>
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-sidebar-foreground">Local LLM UI</span>
                <span className="text-xs text-sidebar-foreground/60">Chat Interface</span>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)}>
              <X className="h-5 w-5" />
            </Button>
          </div>
          {/* Sidebar Content */}
          <div className="flex-1 overflow-y-auto">{navigation}</div>
        </SheetContent>
      </Sheet>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            {/* Mobile menu button */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden h-8 w-8"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            {/* Desktop toggle button */}
            <Button
              variant="ghost"
              size="icon"
              className="hidden md:flex h-8 w-8"
              onClick={toggleSidebar}
              title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
            >
              {sidebarOpen ? (
                <PanelLeftClose className="h-5 w-5" />
              ) : (
                <PanelLeftOpen className="h-5 w-5" />
              )}
            </Button>
            <span className="text-sm font-medium text-muted-foreground">Chat</span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeMenu
              colorTheme={colorTheme}
              visualMode={theme}
              onColorThemeChange={onColorThemeChange}
              onVisualModeChange={onVisualModeChange}
            />
            <Button
              variant="ghost"
              size="icon"
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
