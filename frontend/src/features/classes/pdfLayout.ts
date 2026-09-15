export interface PageSize {
  width: number;
  height: number;
}
export interface PageBox {
  top: number;
  height: number;
  width: number;
}
export const PAGE_GAP = 16;

export function layoutPages(sizes: PageSize[], width: number, zoom: number): PageBox[] {
  let top = PAGE_GAP;
  return sizes.map((size) => {
    const pageWidth = Math.max(100, Math.min(1000, width - 32)) * zoom;
    const height = (pageWidth * size.height) / size.width;
    const box = { top, height, width: pageWidth };
    top += height + PAGE_GAP;
    return box;
  });
}

export function pageAt(boxes: PageBox[], offset: number): number {
  let low = 0,
    high = boxes.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (boxes[middle].top <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function visiblePages(boxes: PageBox[], top: number, height: number): number[] {
  if (!boxes.length) return [];
  const first = Math.max(0, pageAt(boxes, top) - 1);
  const last = Math.min(boxes.length - 1, pageAt(boxes, top + height) + 1);
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

export function renderScale(width: number, height: number, deviceScale: number): number {
  return Math.min(deviceScale, 1.5, Math.sqrt(3_000_000 / (width * height)));
}
