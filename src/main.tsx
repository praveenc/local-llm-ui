import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AppShell } from './layout';
import './styles/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppShell />
  </StrictMode>
);
