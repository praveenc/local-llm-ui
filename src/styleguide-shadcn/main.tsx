import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import ShadcnStyleGuide from './ShadcnStyleGuide';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShadcnStyleGuide />
  </StrictMode>
);
