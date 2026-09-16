import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"

export const PENTEST_PROMPTS = [
  "Map the attack surface of example.com",
  "Start a pentest: define the scope and recon plan",
  "Enumerate subdomains and exposed services",
  "Audit this API for authentication and access-control flaws",
  "Review this repository for secrets and vulnerable code",
  "Analyze these scan results and prioritize the findings",
]

const TYPE_MS = 55
const DELETE_MS = 28
const HOLD_MS = 1600
const PAUSE_MS = 350

export function typewriterFrame(phrases: readonly string[], elapsed: number) {
  const words = phrases.filter(Boolean).map((phrase) => Array.from(phrase))
  if (!words.length) return ""
  const duration = (word: string[]) => PAUSE_MS + word.length * (TYPE_MS + DELETE_MS) + HOLD_MS
  const total = words.reduce((sum, word) => sum + duration(word), 0)
  let time = Math.max(0, elapsed) % total
  for (const word of words) {
    if (time >= duration(word)) {
      time -= duration(word)
      continue
    }
    if (time < PAUSE_MS) return ""
    time -= PAUSE_MS
    if (time < word.length * TYPE_MS) return word.slice(0, Math.floor(time / TYPE_MS)).join("")
    time -= word.length * TYPE_MS
    if (time < HOLD_MS) return word.join("")
    time -= HOLD_MS
    return word.slice(0, Math.max(0, word.length - Math.floor(time / DELETE_MS))).join("")
  }
  return ""
}

export function createTypewriter(phrases: Accessor<readonly string[]>, active: Accessor<boolean>) {
  const [text, setText] = createSignal("")
  createEffect(() => {
    const list = phrases()
    if (!active() || !list.some(Boolean)) {
      setText(list.find(Boolean) ?? "")
      return
    }
    const started = performance.now()
    setText("")
    const timer = setInterval(() => setText(typewriterFrame(list, performance.now() - started)), 28)
    onCleanup(() => clearInterval(timer))
  })
  return text
}
