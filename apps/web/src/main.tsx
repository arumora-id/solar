import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setupPwa, syncThemeColor } from './lib/pwa';
import './styles/global.css';

// A file dropped outside a drop zone must not make the browser / desktop window navigate to it
const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
window.addEventListener('dragover', (e) => {
  if (isFileDrag(e)) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  if (isFileDrag(e)) e.preventDefault();
});

setupPwa();
syncThemeColor();
// "Ikuti sistem" follows the operating system's light/dark switch
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', syncThemeColor);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
