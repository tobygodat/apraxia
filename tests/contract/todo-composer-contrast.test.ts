import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const dialogCss = readFileSync(
  resolve(
    process.cwd(),
    "frontend/src/features/todos/TodoComposerDialog.css",
  ),
  "utf8",
);

type Rgb = readonly [number, number, number];

function parseHexVariable(name: string): Rgb {
  const match = dialogCss.match(
    new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"),
  );
  if (!match?.[1]) throw new Error(`Missing ${name} color token.`);
  return [
    Number.parseInt(match[1].slice(1, 3), 16),
    Number.parseInt(match[1].slice(3, 5), 16),
    Number.parseInt(match[1].slice(5, 7), 16),
  ];
}

function parseRgba(value: string): readonly [...Rgb, number] {
  const channels = value.split(",").map((channel) => Number(channel.trim()));
  if (
    channels.length !== 4 ||
    channels.some((channel) => !Number.isFinite(channel))
  ) {
    throw new Error("Invalid RGBA color token.");
  }
  return [channels[0]!, channels[1]!, channels[2]!, channels[3]!];
}

function parseRgbaVariable(name: string): readonly [...Rgb, number] {
  const match = dialogCss.match(
    new RegExp(`--${name}:\\s*rgba\\(([^)]+)\\)`),
  );
  if (!match?.[1]) throw new Error(`Missing ${name} color token.`);
  return parseRgba(match[1]);
}

function blend(foreground: readonly [...Rgb, number], background: Rgb): Rgb {
  const alpha = foreground[3];
  return [0, 1, 2].map((index) =>
    Math.round(
      foreground[index]! * alpha + background[index]! * (1 - alpha),
    ),
  ) as unknown as Rgb;
}

function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: Rgb): number {
  return (
    channelLuminance(color[0]) * 0.2126 +
    channelLuminance(color[1]) * 0.7152 +
    channelLuminance(color[2]) * 0.0722
  );
}

function contrast(left: Rgb, right: Rgb): number {
  const brightest = Math.max(relativeLuminance(left), relativeLuminance(right));
  const darkest = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (brightest + 0.05) / (darkest + 0.05);
}

describe("Todo composer contrast contract", () => {
  const background = parseHexVariable("dialog-field-background");

  it("keeps the resting field boundary above 3:1", () => {
    const fieldLine = blend(
      parseRgbaVariable("dialog-field-line"),
      background,
    );

    expect(contrast(fieldLine, background)).toBeGreaterThanOrEqual(3);
  });

  it("keeps placeholder copy above 4.5:1", () => {
    const placeholderMatch = dialogCss.match(
      /\.todo-dialog__field input::placeholder\s*\{[^}]*color:\s*rgba\(([^)]+)\)/,
    );
    if (!placeholderMatch?.[1]) {
      throw new Error("Missing Todo placeholder color.");
    }
    const placeholder = blend(parseRgba(placeholderMatch[1]), background);

    expect(contrast(placeholder, background)).toBeGreaterThanOrEqual(4.5);
  });
});
