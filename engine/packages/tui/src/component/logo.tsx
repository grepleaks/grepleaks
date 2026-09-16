import { useTheme } from "../context/theme"

export function Logo() {
  const { theme, mode } = useTheme()
  return (
    <text fg={mode() === "dark" ? "#ffffff" : theme.text} selectable={false}>
      <b>
        grep<span style={{ fg: theme.primary }}>leaks</span>
      </b>
    </text>
  )
}
