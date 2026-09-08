// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HomeHeader } from "./HomeHeader";
import { prepareCover, validateAppearance, type HomeAppearanceService } from "./homeAppearance";
import { coverImageLayout } from "./coverLayout";
import { createRef } from "react";
afterEach(cleanup);

it("saves title and cover removal together, preserving the draft after failure", async () => {
  const service: HomeAppearanceService = {
    load: vi.fn(async () => ({ title: "Studio", coverImage: "data:image/png;base64,AAAA" })),
    save: vi.fn().mockRejectedValueOnce(new Error("Couldn’t save. Try again.")).mockImplementation(async (_user, value) => value),
  };
  render(<HomeHeader userId="owner" service={service} />);
  await screen.findByRole("heading", { name: "Studio" });
  fireEvent.click(screen.getByRole("button", { name: "Customize page" }));
  fireEvent.change(screen.getByLabelText("Page name"), { target: { value: "A quieter place" } });
  fireEvent.click(screen.getByRole("button", { name: "Remove cover" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("alert");
  expect((screen.getByLabelText("Page name") as HTMLInputElement).value).toBe("A quieter place");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("heading", { name: "A quieter place" });
  expect(service.save).toHaveBeenLastCalledWith("owner", { title: "A quieter place", coverImage: null }, expect.any(AbortSignal));
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("discards late account loads and keeps personalization failure separate from the workspace", async () => {
  let resolve!: (value: { title: string; coverImage: null }) => void;
  const service: HomeAppearanceService = { load: vi.fn().mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockRejectedValueOnce(new Error("private provider response")), save: vi.fn() };
  const { rerender } = render(<HomeHeader userId="first" service={service} />);
  rerender(<HomeHeader userId="second" service={service} />);
  await screen.findByRole("button", { name: "Try again" });
  await act(async () => resolve({ title: "First account title", coverImage: null }));
  expect(screen.queryByText("First account title")).toBeNull();
  expect(document.body.textContent).not.toContain("private provider response");
  expect((screen.getByRole("button", { name: "Customize page" }) as HTMLButtonElement).disabled).toBe(true);
});
it("previews an uploaded image and saves only its resized version", async () => {
  const close = vi.fn();
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 3000, height: 1000, close })));
  const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  const encoded = "data:image/webp;base64,AAAA";
  const encode = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(encoded);
  const service: HomeAppearanceService = { load: async () => ({ title: "", coverImage: null }), save: vi.fn(async (_owner, value) => value) };
  try {
    render(<HomeHeader userId="owner" service={service} />);
    await waitFor(() => expect((screen.getByRole("button", { name: "Customize page" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Customize page" }));
    fireEvent.change(screen.getByLabelText("Cover image"), { target: { files: [new File(["image"], "cover.png", { type: "image/png" })] } });
    expect((await screen.findByRole("img", { name: "Cover preview" })).getAttribute("src")).toBe(encoded);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(service.save).toHaveBeenCalledWith("owner", { title: "", coverImage: encoded, coverPositionX: 50, coverPositionY: 50 }, expect.any(AbortSignal));
    expect(close).toHaveBeenCalledOnce();
  } finally { context.mockRestore(); encode.mockRestore(); vi.unstubAllGlobals(); }
});
it("previews crop changes, cancels without writing, and saves the chosen position", async () => {
  const original = { title: "Studio", coverImage: "data:image/png;base64,AAAA", coverPositionX: 25, coverPositionY: 70 };
  const service: HomeAppearanceService = { load: async () => original, save: vi.fn(async (_owner, value) => value) };
  render(<HomeHeader userId="owner" service={service} />);
  await screen.findByRole("heading", { name: "Studio" });
  fireEvent.click(screen.getByRole("button", { name: "Customize page" }));
  fireEvent.change(screen.getByRole("slider", { name: "Vertical position" }), { target: { value: "10" } });
  expect((screen.getByAltText("Cover preview") as HTMLImageElement).style.objectPosition).toBe("25% 10%");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(service.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Customize page" }));
  expect((screen.getByRole("slider", { name: "Vertical position" }) as HTMLInputElement).value).toBe("70");
  fireEvent.change(screen.getByRole("slider", { name: "Horizontal position" }), { target: { value: "100" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(service.save).toHaveBeenCalledWith("owner", { ...original, coverPositionX: 100 }, expect.any(AbortSignal));
});
it("rejects invalid crop coordinates and defaults older appearances to the center", () => {
  for (const position of [-1, 101, .5, NaN, Infinity]) {
    expect(() => validateAppearance({ title: "", coverImage: null, coverPositionX: position })).toThrow(/position/);
    expect(() => validateAppearance({ title: "", coverImage: null, coverPositionY: position })).toThrow(/position/);
  }
  expect(validateAppearance({ title: "", coverImage: null })).toMatchObject({ coverPositionX: 50, coverPositionY: 50 });
});
it("reveals top and bottom edges, fits portrait covers, and hides the collapsed image", () => {
  const crop = coverImageLayout(1000, 180, 600, 1000, 600);
  const partial = coverImageLayout(1000, 400, 600, 1000, 600);
  const full = coverImageLayout(1000, 600, 600, 1000, 600);
  expect(crop.top).toBe(-210);
  expect(partial.top).toBe(-100);
  expect(full).toMatchObject({ top: 0, left: 0, width: 1000, height: 600 });
  const portrait = coverImageLayout(1000, 600, 600, 400, 1000, 0, 100);
  expect(portrait.left).toBeCloseTo(380); expect(portrait.top).toBeCloseTo(0);
  expect(portrait.width).toBeCloseTo(240); expect(portrait.height).toBeCloseTo(600);
  expect(coverImageLayout(1000, 64, 600, 1000, 600).opacity).toBe(0);
});
it("starts with a compact cover and uses native scrolling with a reduced-motion button path", async () => {
  const page = createRef<HTMLDivElement>();
  const service: HomeAppearanceService = { load: async () => ({ title: "Studio", coverImage: "data:image/png;base64,AAAA" }), save: vi.fn() };
  const { container } = render(<div ref={page} style={{ padding: "0px" }}><HomeHeader userId="owner" service={service} scrollRef={page} /><div>Workspace</div></div>);
  await screen.findByRole("heading", { name: "Studio" });
  Object.defineProperties(page.current!, { clientHeight: { value: 800 }, clientWidth: { value: 1000 } });
  const image = container.querySelector(".home-header__cover")!;
  Object.defineProperties(image, { naturalWidth: { value: 1000 }, naturalHeight: { value: 600 } });
  fireEvent.load(image);
  expect(page.current!.scrollTop).toBe(420);
  const frame = container.querySelector(".home-header__frame") as HTMLElement;
  expect(frame.style.height).toBe("180px");
  page.current!.scrollTop = 0; fireEvent.scroll(page.current!);
  expect(frame.style.height).toBe("600px");
  const scrollTo = vi.spyOn(page.current!, "scrollTo");
  const match = vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
  fireEvent.click(screen.getByRole("button", { name: "Collapse cover" }));
  expect(scrollTo).toHaveBeenCalledWith({ top: 536, behavior: "instant" });
  page.current!.scrollTop = 536; fireEvent.scroll(page.current!);
  expect(frame.style.height).toBe("64px");
  expect((image as HTMLElement).style.opacity).toBe("0");
  expect(screen.getByRole("heading", { name: "Studio" })).toBeTruthy();
  match.mockRestore(); scrollTo.mockRestore();
});
it("rejects remote URLs, SVG, excessive names, and unsupported uploads", async () => {
  for (const coverImage of ["https://example.com/image.png", "data:image/svg+xml;base64,AAAA", "data:image/png;base64," + "A".repeat(350000)]) {
    expect(() => validateAppearance({ title: "Home", coverImage })).toThrow();
  }
  expect(() => validateAppearance({ title: "a".repeat(101), coverImage: null })).toThrow();
  await expect(prepareCover(new File(["svg"], "cover.svg", { type: "image/svg+xml" }))).rejects.toThrow(/JPG/);
});
