import {
  FrameBufferRenderable,
  RGBA,
  type OptimizedBuffer,
  type RenderContext,
  type RenderableOptions,
} from "@opentui/core";
import { extend, useTerminalDimensions } from "@opentui/solid";
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
} from "solid-js";
import { useKV } from "../context/kv";
import { tint, useTheme } from "../context/theme";

// Original OpenTUI implementation inspired by sysc-Go's Beams background:
// https://github.com/Nomadcxx/sysc-Go/blob/master/animations/beams.go
// Crossing row/column sweeps with progressively thinner, fading trails.
export function paintBeams(
  buffer: OptimizedBuffer,
  seconds: number,
  background: RGBA,
  palette: RGBA[],
) {
  buffer.clear(background);
  const width = buffer.width;
  const height = buffer.height;
  for (
    let lane = 0;
    lane < Math.min(48, Math.ceil((width + height) / 6));
    lane++
  ) {
    const horizontal = lane % 3 !== 0;
    const length = horizontal ? width : height;
    const cross = horizontal ? height : width;
    const trail = horizontal ? 18 : 9;
    const speed = horizontal ? 12 + ((lane * 7) % 15) : 5 + ((lane * 3) % 7);
    const travel = seconds * speed + lane * 37;
    const cycle = Math.floor(travel / (length + trail + 24));
    const head = Math.floor(travel % (length + trail + 24));
    const axis = (lane * 17 + cycle * 11) % cross;
    const reverse = (lane + cycle) % 2 === 0;
    for (let tail = trail - 1; tail >= 0; tail--) {
      const position = reverse ? length - 1 - head + tail : head - tail;
      if (position < 0 || position >= length) continue;
      const x = horizontal ? position : axis;
      const y = horizontal ? axis : position;
      const fade = 1 - tail / trail;
      // Soft central vignette keeps the foreground dominant, without a rectangular cutout.
      const distance = Math.min(
        1,
        Math.hypot(
          (x - width / 2) / (width * 0.45),
          (y - height / 2) / (height * 0.48),
        ),
      );
      const level = Math.min(
        palette.length - 1,
        Math.floor(fade * fade * (0.2 + 0.8 * distance) * (palette.length - 1)),
      );
      const glyph = horizontal
        ? tail < 2
          ? "━"
          : tail < 8
            ? "─"
            : "╌"
        : tail < 2
          ? "┃"
          : tail < 5
            ? "│"
            : "╎";
      buffer.setCell(x, y, glyph, palette[level]!, background);
    }
  }
}

type BeamsOptions = RenderableOptions<FrameBufferRenderable> & {
  frame: number;
  colors: { background: RGBA; palette: RGBA[] };
};

class BeamsRenderable extends FrameBufferRenderable {
  private seconds = 0;
  private shades: BeamsOptions["colors"];

  constructor(ctx: RenderContext, options: BeamsOptions) {
    super(ctx, {
      ...options,
      width: typeof options.width === "number" ? options.width : 1,
      height: typeof options.height === "number" ? options.height : 1,
      respectAlpha: false,
    });
    this.seconds = options.frame ?? 0;
    this.shades = options.colors ?? {
      background: RGBA.fromHex("#060a0c"),
      palette: [RGBA.fromHex("#060a0c")],
    };
  }

  set frame(value: number) {
    this.seconds = value;
    this.requestRender();
  }

  set colors(value: BeamsOptions["colors"]) {
    this.shades = value;
    this.requestRender();
  }

  protected override renderSelf(buffer: OptimizedBuffer) {
    paintBeams(
      this.frameBuffer,
      this.seconds,
      this.shades.background,
      this.shades.palette,
    );
    super.renderSelf(buffer);
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    beams_background: typeof BeamsRenderable;
  }
}
extend({ beams_background: BeamsRenderable });

export function BeamsBackground() {
  const { theme } = useTheme();
  const kv = useKV();
  const dimensions = useTerminalDimensions();
  const [seconds, setSeconds] = createSignal(0);
  const colors = createMemo(() => ({
    background: theme.background,
    palette: Array.from({ length: 16 }, (_, index) =>
      tint(theme.background, theme.primary, 0.025 + (index / 15) * 0.32),
    ),
  }));
  createEffect(() => {
    if (!kv.get("animations_enabled", true)) return;
    const start = performance.now();
    const timer = setInterval(
      () => setSeconds((performance.now() - start) / 1000),
      50,
    );
    onCleanup(() => clearInterval(timer));
  });
  return (
    <Show when={kv.get("animations_enabled", true)}>
      <beams_background
        position="absolute"
        left={0}
        top={0}
        width={Math.max(1, dimensions().width)}
        height={Math.max(1, dimensions().height)}
        zIndex={0}
        frame={seconds()}
        colors={colors()}
      />
    </Show>
  );
}
