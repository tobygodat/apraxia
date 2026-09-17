// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HomeHeader } from "./HomeHeader";
import { decodedCoverSize, primeCoverImage } from "./coverImageCache";
import { prepareCover, validateAppearance, type HomeAppearanceService } from "./homeAppearance";
import { coverImageLayout } from "./coverLayout";
import { createRef, useState, type MutableRefObject } from "react";
import { cacheNavigationService, NavigationCache } from "../../apps/navigationCache";
import { ColdLoadGate } from "../../apps/coldLoad";
afterEach(cleanup);

// Mirrors HomePage's callback-ref pattern: `pageElement` must be populated
// from the very first render so HomeHeader's layout effect can apply cover
// geometry in the first commit instead of a render behind.
function PageHost({
  service,
  outRef,
}: {
  service: HomeAppearanceService;
  outRef: MutableRefObject<HTMLDivElement | null>;
}) {
  const [page, setPage] = useState<HTMLDivElement | null>(null);
  outRef.current = page;
  return (
    <div
      ref={(node) => {
        setPage(node);
        outRef.current = node;
      }}
      style={{ padding: "0px" }}
    >
      <HomeHeader userId="owner" service={service} pageElement={page} />
      <div>Workspace</div>
    </div>
  );
}

it("saves title and cover removal together, preserving the draft after failure", async () => {
  const service: HomeAppearanceService = {
    load: vi.fn(async () => ({ title: "Studio", coverImage: "data:image/png;base64,AAAA" })),
    save: vi
      .fn()
      .mockRejectedValueOnce(new Error("Couldn’t save. Try again."))
      .mockImplementation(async (_user, value) => value),
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
  expect(service.save).toHaveBeenLastCalledWith(
    "owner",
    { title: "A quieter place", coverImage: null },
    expect.any(AbortSignal),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("renders the cover on first paint from a warmed navigation cache, no collapsed flash", async () => {
  const load = vi.fn(async () => ({ title: "Studio", coverImage: "data:image/png;base64,AAAA" }));
  const source: HomeAppearanceService = { load, save: vi.fn() };
  const cache = new NavigationCache();
  const service = cacheNavigationService(
    source,
    cache,
    "homeAppearance",
    ["load"],
    ["save"],
  ) as unknown as HomeAppearanceService;
  // Warm the cache the way an earlier navigation to Home would.
  await service.load("owner", new AbortController().signal);
  render(<HomeHeader userId="owner" service={service} />);
  expect(screen.getByRole("heading", { name: "Studio" })).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Customize page" }) as HTMLButtonElement).disabled,
  ).toBe(false);
});
it("discards late account loads and keeps personalization failure separate from the workspace", async () => {
  let resolve!: (value: { title: string; coverImage: null }) => void;
  const service: HomeAppearanceService = {
    load: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockRejectedValueOnce(new Error("private provider response")),
    save: vi.fn(),
  };
  const { rerender } = render(<HomeHeader userId="first" service={service} />);
  rerender(<HomeHeader userId="second" service={service} />);
  await screen.findByRole("button", { name: "Try again" });
  await act(async () => resolve({ title: "First account title", coverImage: null }));
  expect(screen.queryByText("First account title")).toBeNull();
  expect(document.body.textContent).not.toContain("private provider response");
  expect(
    (screen.getByRole("button", { name: "Customize page" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
it("previews an uploaded image and saves only its resized version", async () => {
  const close = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 3000, height: 1000, close })),
  );
  const context = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  const encoded = "data:image/webp;base64,AAAA";
  const encode = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(encoded);
  const service: HomeAppearanceService = {
    load: async () => ({ title: "", coverImage: null }),
    save: vi.fn(async (_owner, value) => value),
  };
  try {
    render(<HomeHeader userId="owner" service={service} />);
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Customize page" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Customize page" }));
    fireEvent.change(screen.getByLabelText("Cover image"), {
      target: { files: [new File(["image"], "cover.png", { type: "image/png" })] },
    });
    expect((await screen.findByRole("img", { name: "Cover preview" })).getAttribute("src")).toBe(
      encoded,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(service.save).toHaveBeenCalledWith(
      "owner",
      { title: "", coverImage: encoded, coverPositionX: 50, coverPositionY: 50 },
      expect.any(AbortSignal),
    );
    expect(close).toHaveBeenCalledOnce();
  } finally {
    context.mockRestore();
    encode.mockRestore();
    vi.unstubAllGlobals();
  }
});
it("previews crop changes, cancels without writing, and saves the chosen position", async () => {
  const original = {
    title: "Studio",
    coverImage: "data:image/png;base64,AAAA",
    coverPositionX: 25,
    coverPositionY: 70,
  };
  const service: HomeAppearanceService = {
    load: async () => original,
    save: vi.fn(async (_owner, value) => value),
  };
  render(<HomeHeader userId="owner" service={service} />);
  await screen.findByRole("heading", { name: "Studio" });
  fireEvent.click(screen.getByRole("button", { name: "Customize page" }));
  fireEvent.change(screen.getByRole("slider", { name: "Vertical position" }), {
    target: { value: "10" },
  });
  expect((screen.getByAltText("Cover preview") as HTMLImageElement).style.objectPosition).toBe(
    "25% 10%",
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(service.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Customize page" }));
  expect(
    (screen.getByRole("slider", { name: "Vertical position" }) as HTMLInputElement).value,
  ).toBe("70");
  fireEvent.change(screen.getByRole("slider", { name: "Horizontal position" }), {
    target: { value: "100" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(service.save).toHaveBeenCalledWith(
    "owner",
    { ...original, coverPositionX: 100 },
    expect.any(AbortSignal),
  );
});
it("rejects invalid crop coordinates and defaults older appearances to the center", () => {
  for (const position of [-1, 101, 0.5, NaN, Infinity]) {
    expect(() =>
      validateAppearance({ title: "", coverImage: null, coverPositionX: position }),
    ).toThrow(/position/);
    expect(() =>
      validateAppearance({ title: "", coverImage: null, coverPositionY: position }),
    ).toThrow(/position/);
  }
  expect(validateAppearance({ title: "", coverImage: null })).toMatchObject({
    coverPositionX: 50,
    coverPositionY: 50,
  });
});
it("reveals top and bottom edges, fits portrait covers, and hides the collapsed image", () => {
  const crop = coverImageLayout(1000, 180, 600, 1000, 600);
  const partial = coverImageLayout(1000, 400, 600, 1000, 600);
  const full = coverImageLayout(1000, 600, 600, 1000, 600);
  expect(crop.top).toBe(-210);
  expect(partial.top).toBe(-100);
  expect(full).toMatchObject({ top: 0, left: 0, width: 1000, height: 600 });
  const portrait = coverImageLayout(1000, 600, 600, 400, 1000, 0, 100);
  expect(portrait.left).toBeCloseTo(380);
  expect(portrait.top).toBeCloseTo(0);
  expect(portrait.width).toBeCloseTo(240);
  expect(portrait.height).toBeCloseTo(600);
  expect(coverImageLayout(1000, 64, 600, 1000, 600).opacity).toBe(0);
});
it("starts with a compact cover and uses native scrolling with a reduced-motion button path", async () => {
  const page = createRef<HTMLDivElement>() as MutableRefObject<HTMLDivElement | null>;
  const service: HomeAppearanceService = {
    load: async () => ({ title: "Studio", coverImage: "data:image/png;base64,AAAA" }),
    save: vi.fn(),
  };
  const { container } = render(<PageHost service={service} outRef={page} />);
  await screen.findByRole("heading", { name: "Studio" });
  Object.defineProperties(page.current!, {
    clientHeight: { value: 800 },
    clientWidth: { value: 1000 },
  });
  const image = container.querySelector(".home-header__cover")!;
  Object.defineProperties(image, { naturalWidth: { value: 1000 }, naturalHeight: { value: 600 } });
  fireEvent.load(image);
  expect(page.current!.scrollTop).toBe(420);
  const frame = container.querySelector(".home-header__frame") as HTMLElement;
  expect(frame.style.height).toBe("180px");
  // At rest the page sits at its maximum scroll: the cover above the fold plus
  // the workspace below it exactly fill the viewport, so no part of the calendar
  // hangs past the bottom edge.
  expect(page.current!.style.getPropertyValue("--home-cover-height")).toBe("600px");
  expect(page.current!.style.getPropertyValue("--home-workspace-height")).toBe("620px");
  expect(600 + 620 - page.current!.scrollTop).toBe(800);
  page.current!.scrollTop = 0;
  fireEvent.scroll(page.current!);
  expect(frame.style.height).toBe("600px");
  const scrollTo = vi.spyOn(page.current!, "scrollTo");
  const match = vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
  fireEvent.click(screen.getByRole("button", { name: "Collapse cover" }));
  expect(scrollTo).toHaveBeenCalledWith({ top: 420, behavior: "instant" });
  page.current!.scrollTop = 420;
  fireEvent.scroll(page.current!);
  // The compact cover is the collapse floor, so it stays visible rather than
  // shrinking to a bare title bar.
  expect(frame.style.height).toBe("180px");
  expect((image as HTMLElement).style.opacity).toBe("1");
  expect(screen.getByRole("heading", { name: "Studio" })).toBeTruthy();
  match.mockRestore();
  scrollTo.mockRestore();
});
it("applies cover geometry on the first commit for a warm revisit, no intermediate flash", async () => {
  // Relies on the previous test having already decoded and cached the
  // dimensions for this same data URL, mirroring a real revisit.
  const page = createRef<HTMLDivElement>() as MutableRefObject<HTMLDivElement | null>;
  const service: HomeAppearanceService = {
    load: async () => ({ title: "Studio", coverImage: "data:image/png;base64,AAAA" }),
    save: vi.fn(),
  };
  const cache = new NavigationCache();
  const wrapped = cacheNavigationService(
    service,
    cache,
    "homeAppearanceRevisit",
    ["load"],
    ["save"],
  ) as unknown as HomeAppearanceService;
  await wrapped.load("owner", new AbortController().signal);
  const { container } = render(<PageHost service={wrapped} outRef={page} />);
  await screen.findByRole("heading", { name: "Studio" });
  Object.defineProperties(page.current!, {
    clientHeight: { value: 800 },
    clientWidth: { value: 1000 },
  });
  // No fireEvent.load here: the cached decoded size should already be in
  // effect, so the cover geometry (page classed, custom properties set) is
  // applied by HomeHeader's layout effect without waiting on a decode event.
  expect(page.current!.classList.contains("home-page--cover")).toBe(true);
  const frame = container.querySelector(".home-header__frame") as HTMLElement;
  expect(frame.style.height).toBe("180px");
});
it("caps the decoded cover size cache with FIFO eviction", async () => {
  decodedCoverSize.clear();
  for (let i = 0; i < 5; i++) {
    const coverImage = `data:image/png;base64,COVER${i}`;
    const service: HomeAppearanceService = {
      load: async () => ({ title: "Studio", coverImage }),
      save: vi.fn(),
    };
    const { container, unmount } = render(<HomeHeader userId="owner" service={service} />);
    await screen.findByRole("heading", { name: "Studio" });
    const img = container.querySelector("img.home-header__cover") as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", { value: 100 + i, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 50 + i, configurable: true });
    fireEvent.load(img);
    unmount();
  }
  expect(decodedCoverSize.size).toBe(4);
  expect(decodedCoverSize.has("data:image/png;base64,COVER0")).toBe(false);
  for (let i = 1; i < 5; i++) {
    expect(decodedCoverSize.has(`data:image/png;base64,COVER${i}`)).toBe(true);
  }
});
it("primeCoverImage decodes a cover ahead of the header mounting it", () => {
  decodedCoverSize.clear();
  const src = "data:image/png;base64,PRIMED";
  const instances: { onload: (() => void) | null; src: string }[] = [];
  class FakeImage {
    onload: (() => void) | null = null;
    naturalWidth = 320;
    naturalHeight = 240;
    src = "";
    constructor() {
      instances.push(this);
    }
  }
  vi.stubGlobal("Image", FakeImage as unknown as typeof Image);
  try {
    primeCoverImage(src);
    expect(instances).toHaveLength(1);
    expect(instances[0].src).toBe(src);
    instances[0].onload?.();
    expect(decodedCoverSize.get(src)).toEqual({ width: 320, height: 240 });
    // Already decoded: a second call must not create another Image.
    primeCoverImage(src);
    expect(instances).toHaveLength(1);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("stays cold-load pending until the cover image decodes, then reveals", async () => {
  // happy-dom resolves a data-URL <img> synchronously on mount instead of
  // waiting for a real decode, so the auto-dispatched "load" event is
  // swallowed here to observe the gate's pending state before the image
  // is (manually) reported ready, mirroring a real browser's timing.
  const originalDispatch = HTMLImageElement.prototype.dispatchEvent;
  const dispatchSpy = vi
    .spyOn(HTMLImageElement.prototype, "dispatchEvent")
    .mockImplementation(function (this: HTMLImageElement, event: Event) {
      if (event.type === "load") return true;
      return originalDispatch.call(this, event);
    });
  try {
    const service: HomeAppearanceService = {
      load: async () => ({ title: "Studio", coverImage: "data:image/png;base64,COLD" }),
      save: vi.fn(),
    };
    const { container } = render(
      <ColdLoadGate>
        <HomeHeader userId="owner" service={service} />
      </ColdLoadGate>,
    );
    await screen.findByRole("heading", { name: "Studio" });
    expect(container.querySelector(".cold-load")?.getAttribute("data-cold")).toBe("true");
    const image = container.querySelector("img.home-header__cover") as HTMLImageElement;
    Object.defineProperty(image, "naturalWidth", { value: 200, configurable: true });
    Object.defineProperty(image, "naturalHeight", { value: 100, configurable: true });
    dispatchSpy.mockRestore();
    fireEvent.load(image);
    // The gate defers its reveal to a rAF/timeout check that pending is still zero.
    await waitFor(() =>
      expect(container.querySelector(".cold-load")?.getAttribute("data-cold")).toBeNull(),
    );
  } finally {
    dispatchSpy.mockRestore();
  }
});
it("rejects remote URLs, SVG, excessive names, and unsupported uploads", async () => {
  for (const coverImage of [
    "https://example.com/image.png",
    "data:image/svg+xml;base64,AAAA",
    "data:image/png;base64," + "A".repeat(350000),
  ]) {
    expect(() => validateAppearance({ title: "Home", coverImage })).toThrow();
  }
  expect(() => validateAppearance({ title: "a".repeat(101), coverImage: null })).toThrow();
  await expect(
    prepareCover(new File(["svg"], "cover.svg", { type: "image/svg+xml" })),
  ).rejects.toThrow(/JPG/);
});
