import { expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { createTypewriter } from "../../src/prompt/typewriter"

test("animated suggestions stay outside the editor content and submitted text", async () => {
  let input: TextareaRenderable | undefined
  let submitted = ""
  const app = await testRender(
    () => {
      const [empty, setEmpty] = createSignal(true)
      const placeholder = createTypewriter(() => ["Map the attack surface", "Audit the API"], empty)
      return (
        <textarea
          ref={(ref: TextareaRenderable) => {
            input = ref
          }}
          width={60}
          height={3}
          placeholder={placeholder()}
          onContentChange={() => setEmpty(input?.plainText === "")}
          onSubmit={() => {
            submitted = input?.plainText ?? ""
          }}
        />
      )
    },
    { width: 64, height: 8 },
  )
  try {
    await app.renderOnce()
    input!.focus()
    await Bun.sleep(500)
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Ma")
    expect(input!.plainText).toBe("")
    await app.mockInput.typeText("Audit my staging API")
    await Bun.sleep(100)
    await app.renderOnce()
    expect(input!.plainText).toBe("Audit my staging API")
    expect(app.captureCharFrame()).not.toContain("Map the attack surface")
    input!.submit()
    expect(submitted).toBe("Audit my staging API")
  } finally {
    app.renderer.destroy()
  }
})
