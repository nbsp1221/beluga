import '@workspace/ui/globals.css';
import { ThemeProvider } from '@workspace/ui/components/theme-provider';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing desktop window root.');
}

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
