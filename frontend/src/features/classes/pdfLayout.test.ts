import { expect, it } from "vitest";
import { layoutPages, pageAt, renderScale, visiblePages } from "./pdfLayout";

it("keeps stable offsets for mixed portrait and landscape pages", () => {
  const boxes = layoutPages(
    [
      { width: 600, height: 800 },
      { width: 800, height: 600 },
    ],
    632,
    1,
  );
  expect(boxes).toEqual([
    { top: 16, width: 600, height: 800 },
    { top: 832, width: 600, height: 450 },
  ]);
  expect(pageAt(boxes, 850)).toBe(1);
});
it("renders only nearby pages even for a thousand-page document", () => {
  const boxes = layoutPages(
    Array.from({ length: 1000 }, () => ({ width: 600, height: 800 })),
    632,
    1,
  );
  expect(visiblePages(boxes, boxes[500].top, 900)).toEqual([499, 500, 501, 502]);
  expect(visiblePages([], 0, 600)).toEqual([]);
});
it("bounds high-resolution canvas memory", () => {
  expect(renderScale(800, 1000, 3)).toBe(1.5);
  expect(4000 * 6000 * renderScale(4000, 6000, 3) ** 2).toBeCloseTo(3_000_000);
});
