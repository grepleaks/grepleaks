import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createTypewriter, typewriterFrame } from "../../src/prompt/typewriter"

test("writes, holds, erases and loops through every suggestion one character at a time", () => {
  const seen = new Set<string>()
  let previous = ""
  for (let elapsed = 0; elapsed <= 9000; elapsed += 7) {
    const text = typewriterFrame(["abc", "de"], elapsed)
    expect(Math.abs(text.length - previous.length)).toBeLessThanOrEqual(1)
    expect(text.startsWith(previous) || previous.startsWith(text)).toBe(true)
    seen.add(text)
    previous = text
  }
  expect([...seen]).toEqual(["", "a", "ab", "abc", "d", "de"])
  expect(typewriterFrame(["abc", "de"], 900)).toBe("abc")
  expect(typewriterFrame(["abc", "de"], 2100)).toBe("abc")
  expect(typewriterFrame(["abc", "de"], 2143)).toBe("ab")
  expect(typewriterFrame(["abc", "de"], 415 + 4315)).toBe("a")
})

test("empty phrases and Unicode characters never produce undefined or broken surrogates", () => {
  expect(typewriterFrame([], 100)).toBe("")
  expect(typewriterFrame([""], 100)).toBe("")
  expect(typewriterFrame(["", "🔎x"], 405)).toBe("🔎")
})

test("pauses when input is occupied or animations are off, restarts, and cleans up on unmount", async () => {
  const state = createRoot((dispose) => {
    const [active, setActive] = createSignal(true)
    return { text: createTypewriter(() => ["abc", "de"], active), setActive, dispose }
  })
  try {
    await Bun.sleep(470)
    expect(["a", "ab", "abc"]).toContain(state.text())
    state.setActive(false)
    expect(state.text()).toBe("abc")
    await Bun.sleep(90)
    expect(state.text()).toBe("abc")
    state.setActive(true)
    expect(state.text()).toBe("")
    state.dispose()
    await Bun.sleep(440)
    expect(state.text()).toBe("")
  } finally {
    state.dispose()
  }
})
