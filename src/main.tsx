import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@cloudscape-design/global-styles/index.css';

import { BaseAppLayout } from './layout';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BaseAppLayout />
  </StrictMode>
);
