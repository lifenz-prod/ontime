import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { registerServiceWorker } from './service-worker/registerServiceWorker';
import App from './App';

import './index.scss';

const container = document.getElementById('root');
const root = createRoot(container as Element);

root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
