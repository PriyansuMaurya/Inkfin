/**
 * Renderer entry point.
 *
 * Import order matters: tokens define the semantic custom properties, Tailwind's
 * reset and utilities sit on top of them, and the component styles read only
 * those tokens so no literal colour ever appears in a component.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles/tokens.css';
import './styles/tailwind.css';
import './styles/app.css';
import './styles/document.css';

import { App } from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('the renderer root element is missing');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
