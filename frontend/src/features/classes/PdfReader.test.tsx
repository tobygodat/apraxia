// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mock = vi.hoisted(() => ({ destroy: vi.fn(async () => {}), cleanup: vi.fn(), cancel: vi.fn(), load: vi.fn() }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: mock.load,
  TextLayer: class { render() { return Promise.resolve(); } cancel() {} },
}));
import PdfReader from "./PdfReader";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  mock.load.mockReturnValue({ destroy: mock.destroy, promise: Promise.resolve({ numPages: 80, getPage: async () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }),
    cleanup: mock.cleanup, streamTextContent: () => ({}), render: () => ({ promise: Promise.resolve(), cancel: mock.cancel }),
  }) }) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const file = new File(["%PDF"], "Notes.pdf", { type: "application/pdf" });

it("releases distant pages and preserves scroll when the toolbar opens", async () => {
  const view = render(<PdfReader file={file} showTools={false} />);
  await waitFor(() => expect(screen.getByRole("region", { name: "Page 1" })).toBeTruthy());
  const scroll = screen.getByRole("region", { name: "PDF pages: Notes.pdf" });
  expect(view.container.querySelectorAll("canvas").length).toBeLessThanOrEqual(4);
  scroll.scrollTop = 40_000; fireEvent.scroll(scroll);
  await waitFor(() => expect(screen.queryByRole("region", { name: "Page 1" })).toBeNull());
  expect(view.container.querySelectorAll("canvas").length).toBeLessThanOrEqual(4);
  expect(mock.cancel).toHaveBeenCalled();
  view.rerender(<PdfReader file={file} showTools />);
  expect(screen.getByRole("toolbar", { name: "PDF toolbar" })).toBeTruthy();
  expect(scroll.scrollTop).toBe(40_000);
  expect(screen.getByRole("region", { name: "PDF pages: Notes.pdf" })).toBe(scroll);
  expect(mock.load).toHaveBeenCalledTimes(1);
  view.unmount(); expect(mock.destroy).toHaveBeenCalledTimes(1);
});

it("navigates to a page and retains that page when zoom changes", async () => {
  render(<PdfReader file={file} showTools />);
  const input = screen.getByRole("spinbutton", { name: "Page number" });
  await waitFor(() => expect(input.hasAttribute("disabled")).toBe(false));
  fireEvent.change(input, { target: { value: "30" } });
  fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(screen.getByRole("region", { name: "Page 30" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect((input as HTMLInputElement).value).toBe("30");
  expect(mock.load).toHaveBeenCalledTimes(1);
});

it("reports a broken document and can retry", async () => {
  mock.load.mockReturnValueOnce({ destroy: mock.destroy, promise: Promise.reject(new Error("Invalid PDF")) });
  render(<PdfReader file={file} showTools={false} />);
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.getByRole("region", { name: "Page 1" })).toBeTruthy());
});
