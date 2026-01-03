import { Moon, Sun } from 'lucide-react';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Toaster } from '@/components/ui/sonner';

interface AppLayoutProps {
  navigation: React.ReactNode;
  children: React.ReactNode;
  navigationOpen?: boolean;
  onNavigationChange?: (open: boolean) => void;
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
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Desktop Sidebar */}
      <aside
        className={`hidden md:flex md:flex-col border-r bg-sidebar transition-all duration-300 ${
          navigationOpen ? 'md:w-80' : 'md:w-0'
        } overflow-hidden`}
      >
        {navigationOpen && <div className="flex-1 overflow-y-auto">{navigation}</div>}
      </aside>

      {/* Mobile Sidebar */}
      <Sheet open={navigationOpen} onOpenChange={onNavigationChange}>
        <SheetContent side="left" className="w-80 p-0 md:hidden">
          {navigation}
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-14 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            <Sheet>
              <SheetTrigger asChild className="md:hidden">
                <Button variant="ghost" size="icon">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </svg>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-80 p-0">
                {navigation}
              </SheetContent>
            </Sheet>
            <h1 className="text-lg font-semibold">Local LLM UI</h1>
          </div>
          <Button variant="ghost" size="icon" onClick={toggleTheme}>
            {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
          </Button>
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>

      {/* Toast Notifications */}
      <Toaster />
    </div>
  );
}
