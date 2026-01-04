'use client';

import { Moon, PanelLeft, Sun } from 'lucide-react';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';

interface AppLayoutProps {
  navigation: React.ReactNode;
  children: React.ReactNode;
  navigationOpen?: boolean;
  onNavigationChange?: (open: boolean) => void;
}

// Custom trigger component that uses the sidebar context
function CustomSidebarTrigger() {
  const { toggleSidebar } = useSidebar();

  return (
    <Button variant="ghost" size="icon" onClick={toggleSidebar} className="h-8 w-8">
      <PanelLeft className="h-5 w-5" />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
}

export function AppLayout({
  navigation,
  children,
  navigationOpen = true,
  onNavigationChange,
}: AppLayoutProps) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const root = window.document.documentElement;
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    const initialTheme = savedTheme || 'light';
    setTheme(initialTheme);
    root.classList.toggle('dark', initialTheme === 'dark');
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    window.document.documentElement.classList.toggle('dark', newTheme === 'dark');
  };

  return (
    <SidebarProvider defaultOpen={navigationOpen} onOpenChange={onNavigationChange}>
      <Sidebar variant="sidebar" collapsible="offcanvas">
        <SidebarHeader className="border-b border-sidebar-border">
          <div className="flex items-center gap-2 px-2 py-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <span className="text-sm font-bold">L</span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-sidebar-foreground">Local LLM UI</span>
              <span className="text-xs text-sidebar-foreground/60">Chat Interface</span>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent className="p-0 [&_.sidebar-container]:h-full">{navigation}</SidebarContent>
      </Sidebar>

      <SidebarInset>
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            <CustomSidebarTrigger />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <span className="text-sm font-medium text-muted-foreground">Chat</span>
          </div>
          <Button variant="ghost" size="icon" onClick={toggleTheme}>
            {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
          </Button>
        </header>

        {/* Content Area */}
        <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
      </SidebarInset>

      {/* Toast Notifications */}
      <Toaster />
    </SidebarProvider>
  );
}
