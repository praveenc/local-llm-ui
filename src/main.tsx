import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import { QueryClientProvider } from '@tanstack/react-query';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { queryClient } from '@/lib/query-client';
import { migrateLegacyApiKeys } from '@/utils/legacyApiKeys';

import { AppShell } from './layout';
import './styles/globals.css';

// Before the app reads the preferences and before any model fetch
migrateLegacyApiKeys();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  </StrictMode>
);
