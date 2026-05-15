/**
 * main.tsx - React 애플리케이션 진입점
 *
 * 기능:
 * - React 18 createRoot로 앱 마운트
 * - App 컴포넌트 렌더링
 * - StrictMode 활성화 (개발模式下에서 이중 렌더링으로 잠재적 문제 파악)
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const container = document.getElementById('root');

if (!container) {
  throw new Error('[main.tsx] #root element not found. Check index.html.');
}

const root = createRoot(container);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);