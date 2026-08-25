import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { useEditor } from './store/editorStore.js';
import { useViewport } from './canvas/viewport.js';
import './styles.css';

// Dev-only handles on the stores, for poking at state from the console and for
// driving the app in automated checks. Stripped from production builds.
if (import.meta.env.DEV) {
  Object.assign(window, { __editor: useEditor, __viewport: useViewport });
}

const container = document.getElementById('root');
if (!container) throw new Error('missing #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
