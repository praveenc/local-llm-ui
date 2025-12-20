import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@cloudscape-design/global-styles/index.css';

import { AppShell } from './layout';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppShell />
  </StrictMode>
);
