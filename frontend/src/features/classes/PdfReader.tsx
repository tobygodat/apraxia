import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { layoutPages, pageAt, renderScale, visiblePages, PAGE_GAP, type PageBox, type PageSize } from "./pdfLayout";
import "./pdfReader.css";

GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfReader({ file, showTools }: { file: File; showTools: boolean }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState({ width: 800, height: 600, top: 0 });
  const scroll = useRef<HTMLDivElement>(null);
  const previousBoxes = useRef<PageBox[]>([]);
  const frame = useRef<number | null>(null);
  const [pageInput, setPageInput] = useState("1");

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof getDocument> | undefined;
    setError(""); setDocument(null); setSizes([]);
    void (async () => {
      const data = new Uint8Array(await file.arrayBuffer());
      if (cancelled) return;
      task = getDocument({ data, cMapUrl: "/pdf-assets/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdf-assets/standard_fonts/", wasmUrl: "/pdf-assets/wasm/" });
      const pdf = await task.promise;
      // Read only dimensions up front: stable placeholders prevent scroll jumps.
      const dimensions: PageSize[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        if (cancelled) return;
        const page = await pdf.getPage(i);
        const size = page.getViewport({ scale: 1 });
        dimensions.push({ width: size.width, height: size.height });
        page.cleanup();
      }
      if (!cancelled) { setSizes(dimensions); setDocument(pdf); }
    })().catch(reason => {
      if (!cancelled) setError(reason?.name === "PasswordException" ? "This PDF is password protected. Choose an unlocked copy." : "Couldn’t open this PDF. Try again or choose another copy.");
    });
    return () => { cancelled = true; void task?.destroy().catch(() => undefined); };
  }, [file, retry]);

  useEffect(() => {
    const node = scroll.current;
    if (!node) return;
    const update = () => setViewport({ width: node.clientWidth, height: node.clientHeight, top: node.scrollTop });
    const observer = new ResizeObserver(update);
    observer.observe(node); update();
    return () => { observer.disconnect(); if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, []);

  const boxes = useMemo(() => layoutPages(sizes, viewport.width, zoom), [sizes, viewport.width, zoom]);
  useLayoutEffect(() => {
    const node = scroll.current;
    const old = previousBoxes.current;
    if (node && old.length && boxes.length) {
      const index = Math.min(pageAt(old, node.scrollTop), boxes.length - 1);
      const fraction = (node.scrollTop - old[index].top) / old[index].height;
      node.scrollTop = Math.max(0, boxes[index].top + fraction * boxes[index].height);
      setViewport(value => ({ ...value, top: node.scrollTop }));
    }
    previousBoxes.current = boxes;
  }, [boxes]);
  const current = boxes.length ? pageAt(boxes, viewport.top + 16) + 1 : 1;
  useEffect(() => setPageInput(String(current)), [current]);
  const active = visiblePages(boxes, viewport.top, viewport.height);
  const last = boxes[boxes.length - 1];

  function goTo(page: number) {
    const index = Math.min(boxes.length - 1, Math.max(0, Math.round(page) - 1));
    if (!Number.isFinite(index) || !boxes[index] || !scroll.current) { setPageInput(String(current)); return; }
    scroll.current.scrollTop = boxes[index].top - PAGE_GAP;
    setViewport(value => ({ ...value, top: scroll.current!.scrollTop }));
    setPageInput(String(index + 1));
  }

  return <div className="pdf-reader">
    {showTools && <div className="pdf-toolbar" role="toolbar" aria-label="PDF toolbar">
      <button type="button" disabled={!document || current === 1} onClick={() => goTo(current - 1)} aria-label="Previous page">Previous</button>
      <form onSubmit={event => { event.preventDefault(); goTo(Number(pageInput)); }}>
        <input aria-label="Page number" type="number" min="1" max={sizes.length || 1} value={pageInput} onChange={event => setPageInput(event.target.value)} disabled={!document} />
        <span> / {sizes.length || "—"}</span>
      </form>
      <button type="button" disabled={!document || current === sizes.length} onClick={() => goTo(current + 1)} aria-label="Next page">Next</button>
      <button type="button" disabled={zoom <= .75} onClick={() => setZoom(value => Math.max(.75, value - .25))} aria-label="Zoom out">−</button>
      <button type="button" onClick={() => setZoom(1)} title="Fit width">{Math.round(zoom * 100)}%</button>
      <button type="button" disabled={zoom >= 2} onClick={() => setZoom(value => Math.min(2, value + .25))} aria-label="Zoom in">+</button>
    </div>}
    <div ref={scroll} className="pdf-scroll" tabIndex={0} role="region" aria-label={`PDF pages: ${file.name}`} onScroll={() => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => { frame.current = null; if (scroll.current) setViewport(value => ({ ...value, top: scroll.current!.scrollTop })); });
    }}>
      {error ? <div className="pdf-message" role="alert"><p>{error}</p><button onClick={() => setRetry(value => value + 1)}>Try again</button></div> : !document ? <p className="pdf-message" role="status">Preparing PDF…</p> : <div className="pdf-pages" style={{ height: last ? last.top + last.height + PAGE_GAP : 0, minWidth: last ? last.width + 32 : 0 }}>
        {active.map(index => <PdfPage key={index} document={document} pageNumber={index + 1} box={boxes[index]} />)}
      </div>}
    </div>
  </div>;
}

function PdfPage({ document, pageNumber, box }: { document: PDFDocumentProxy; pageNumber: number; box: PageBox }) {
  const root = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let page: PDFPageProxy | undefined;
    let render: RenderTask | undefined;
    let text: TextLayer | undefined;
    const container = root.current!;
    const canvas = window.document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    container.appendChild(canvas);
    const layer = window.document.createElement("div");
    layer.className = "textLayer";
    container.appendChild(layer);
    setError(false);
    void (async () => {
      page = await document.getPage(pageNumber);
      if (cancelled) return;
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: box.width / natural.width });
      const resolution = renderScale(viewport.width, viewport.height, window.devicePixelRatio || 1);
      canvas.width = Math.ceil(viewport.width * resolution);
      canvas.height = Math.ceil(viewport.height * resolution);
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
      container.style.setProperty("--scale-factor", String(viewport.scale));
      container.style.setProperty("--total-scale-factor", String(viewport.scale));
      render = page.render({ canvas, viewport, transform: [resolution, 0, 0, resolution, 0, 0] });
      await render.promise;
      if (cancelled) return;
      text = new TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport });
      await text.render();
    })().catch(reason => { if (!cancelled && reason?.name !== "RenderingCancelledException") setError(true); }).finally(() => { if (cancelled) page?.cleanup(); });
    return () => {
      cancelled = true; render?.cancel(); text?.cancel();
      canvas.width = 0; canvas.height = 0; canvas.remove(); layer.remove();
      page?.cleanup();
    };
  }, [document, pageNumber, box.width, box.height]);
  return <section className="pdf-page" aria-label={`Page ${pageNumber}`} style={{ top: box.top, width: box.width, height: box.height }}>
    <div ref={root} className="pdf-page-content" />
    {error && <p className="pdf-page-error" role="alert">Page {pageNumber} couldn’t render. Scroll away and back to retry.</p>}
  </section>;
}
