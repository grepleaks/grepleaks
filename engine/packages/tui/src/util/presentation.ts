// grepleaks — exit/epilogue banner. "grepleaks" wordmark (pagga font) in the
// brand two-tone: "grep" white, "leaks" cyan. Cols [0,16) = grep, [16,..) = leaks.
const GL = [
  "░█▀▀░█▀▄░█▀▀░█▀█░█░░░█▀▀░█▀█░█░█░█▀▀",
  "░█░█░█▀▄░█▀▀░█▀▀░█░░░█▀▀░█▀█░█▀▄░▀▀█",
  "░▀▀▀░▀░▀░▀▀▀░▀░░░▀▀▀░▀▀▀░▀░▀░▀░▀░▀▀▀",
]
const SPLIT = 16

const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[90m"
const grepFg = "\x1b[38;2;255;255;255m" // white wordmark
const leaksFg = "\x1b[38;2;34;211;238m" // brand cyan
const dot = "\x1b[38;2;42;54;60m" // ░ texture

function wordmark(pad = "") {
  return GL.map(
    (line) =>
      pad +
      [...line]
        .map((char, i) => {
          if (char === " ") return " "
          if (char === "░") return `${dot}░${reset}`
          return `${bold}${i < SPLIT ? grepFg : leaksFg}${char}${reset}`
        })
        .join(""),
  )
}

export function sessionEpilogue(input: { title: string; sessionID?: string }) {
  const weak = (text: string) => `${dim}${text.padEnd(10, " ")}${reset}`
  return [
    ...wordmark("  "),
    "",
    `  ${weak("Session")}${bold}${input.title}${reset}`,
    `  ${weak("Continue")}${bold}grepleaks -s ${input.sessionID}${reset}`,
    "",
  ].join("\n")
}
