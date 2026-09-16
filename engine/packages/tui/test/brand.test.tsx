import { tmpdir } from "./fixture/fixture";
import { expect, test } from "bun:test";
import { TextareaRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { LogoRain } from "../src/component/logo-rain";
import { BeamsBackground } from "../src/component/beams-background";
import { KVProvider } from "../src/context/kv";
import { ThemeProvider } from "../src/context/theme";
import { TuiConfigProvider } from "../src/config";
import { TestTuiContexts } from "./fixture/tui-environment";
import { createTuiResolvedConfig } from "./fixture/tui-runtime";

test("brand renders in both themes and survives a narrow, short terminal resize", async () => {
  await using dir = await tmpdir();
  for (const config of [
    { mode: "dark", animations: false },
    { mode: "dark", animations: true },
    { mode: "light", animations: false },
  ] as const) {
    const mode = config.mode;
    await Bun.write(
      `${dir.path}/kv.json`,
      JSON.stringify({ animations_enabled: config.animations }),
    );
    let clicks = 0;
    let input: TextareaRenderable | undefined;
    const app = await testRender(
      () => (
        <TestTuiContexts paths={{ state: dir.path }}>
          <TuiConfigProvider
            config={createTuiResolvedConfig({ theme: "grepleaks" })}
          >
            <KVProvider>
              <ThemeProvider
                mode={mode}
                source={{ discover: async () => ({}) }}
              >
                <box flexGrow={1}>
                  <BeamsBackground />
                  <box
                    zIndex={1}
                    flexGrow={1}
                    alignItems="center"
                    justifyContent="center"
                  >
                    <LogoRain />
                    <box
                      width={20}
                      height={1}
                      backgroundColor="#060a0c"
                      onMouseUp={() => clicks++}
                    >
                      <text>OPEN CATALOG</text>
                    </box>
                    <textarea
                      ref={(ref: TextareaRenderable) => {
                        input = ref;
                      }}
                      width={60}
                      height={3}
                      backgroundColor="#060a0c"
                    />
                  </box>
                </box>
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </TestTuiContexts>
      ),
      { width: 100, height: 36 },
    );
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        await app.renderOnce();
        if (app.captureCharFrame().includes("██████")) break;
        await Bun.sleep(10);
      }
      await app.waitForFrame((frame) => frame.includes("██████"));
      expect(app.captureCharFrame()).toContain("██████");
      expect(app.captureCharFrame()).not.toContain("▐█▪ ▪█▌");
      expect(/[━─╌┃│╎]/.test(app.captureCharFrame())).toBe(config.animations);
      const rows = app.captureCharFrame().split("\n");
      if (config.animations)
        expect(rows.slice(18).some((row) => /[━─╌┃│╎]/.test(row))).toBe(true);
      const buttonRow = rows.findIndex((row) => row.includes("OPEN CATALOG"));
      await app.mockMouse.click(42, buttonRow);
      expect(clicks).toBe(1);
      input!.focus();
      await app.mockInput.typeText("Audit my staging API");
      if (config.animations) {
        const before = app.captureCharFrame();
        await Bun.sleep(400);
        await app.renderOnce();
        expect(app.captureCharFrame()).not.toBe(before);
        expect(app.captureCharFrame()).toContain("██████");
      }
      expect(input!.plainText).toBe("Audit my staging API");
      expect(app.captureCharFrame()).not.toMatch(/~o>|<o~/);
      if (mode === "dark") {
        const spans = app.captureSpans().lines.flatMap((line) => line.spans);
        expect(
          spans.some(
            (span) =>
              span.text.includes("██████") &&
              span.fg.toInts().slice(0, 3).join() === "255,255,255",
          ),
        ).toBe(true);
        expect(
          spans.some(
            (span) =>
              span.text.includes("██████") &&
              span.fg.toInts().slice(0, 3).join() === "34,211,238",
          ),
        ).toBe(true);
      }
      app.resize(40, 24);
      await app.waitForFrame((frame) => frame.includes("grepleaks"));
      expect(app.captureCharFrame()).toContain("grepleaks");
      app.resize(24, 12);
      await app.waitForFrame((frame) => frame.includes("grepleaks"));
      expect(app.captureCharFrame()).toContain("grepleaks");
      expect(app.captureCharFrame()).not.toContain("▐█▪ ▪█▌");
    } finally {
      app.renderer.destroy();
    }
  }
});
