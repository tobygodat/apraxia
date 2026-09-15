export const COLLAPSED_COVER_HEIGHT = 64;
export const COMPACT_COVER_HEIGHT = 180;

/** Zoom out from the saved crop to fit the complete image, including portrait covers. */
export function coverImageLayout(
  width: number,
  height: number,
  expandedHeight: number,
  naturalWidth: number,
  naturalHeight: number,
  x = 50,
  y = 50,
) {
  const progress = Math.max(
    0,
    Math.min(
      1,
      (height - COMPACT_COVER_HEIGHT) / Math.max(1, expandedHeight - COMPACT_COVER_HEIGHT),
    ),
  );
  const cropScale = Math.max(width / naturalWidth, COMPACT_COVER_HEIGHT / naturalHeight);
  const fitScale = Math.min(width / naturalWidth, expandedHeight / naturalHeight);
  const scale = cropScale + (fitScale - cropScale) * progress;
  const renderedWidth = naturalWidth * scale;
  const renderedHeight = naturalHeight * scale;
  return {
    width: renderedWidth,
    height: renderedHeight,
    left: ((width - renderedWidth) * (x + (50 - x) * progress)) / 100,
    top: ((height - renderedHeight) * (y + (50 - y) * progress)) / 100,
    opacity: Math.max(0, Math.min(1, (height - COLLAPSED_COVER_HEIGHT) / 48)),
  };
}
