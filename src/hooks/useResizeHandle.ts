import { useEffect, useRef, useCallback, useState } from 'react';

interface UseResizeOptions {
  direction: 'horizontal' | 'vertical';
  onResize: (delta: number) => void;
  invert?: boolean;
}

export function useResizeHandle({ direction, onResize, invert = false }: UseResizeOptions) {
  const isDragging = useRef(false);
  const lastPos = useRef(0);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  const handleRef = useCallback((el: HTMLElement | null) => {
    if (!el) return;

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      lastPos.current = direction === 'horizontal' ? e.clientX : e.clientY;
      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const current = direction === 'horizontal' ? e.clientX : e.clientY;
      let delta = current - lastPos.current;
      if (invert) delta = -delta;
      onResizeRef.current(delta);
      lastPos.current = current;
    };

    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    el.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [direction, invert]);

  return handleRef;
}
