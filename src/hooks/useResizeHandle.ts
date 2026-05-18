/**
 * React hook providing a draggable resize handle for horizontal or vertical
 * panel splitting. Returns a ref callback to attach to the handle element.
 */
import { useEffect, useRef, useCallback, useState } from 'react';

/** 리사이즈 핸들 옵션 */
interface UseResizeOptions {
  /** 리사이즈 방향 (가로/세로) */
  direction: 'horizontal' | 'vertical';
  /** 드래그 델타 값 콜백 */
  onResize: (delta: number) => void;
  /** 방향 반전 여부 */
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
