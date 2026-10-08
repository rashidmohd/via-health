function initialsOf(name: string): string {
  // Skip titles such as "Dr." or "Prof."
  const parts = name.trim().split(/\s+/).filter((part) => part && !part.endsWith('.'))
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts
  return letters.map((part) => [...part][0]?.toLocaleUpperCase() ?? '').join('')
}

/** Round initials badge. Decorative: the name is always shown next to it. */
export function Initials({ name }: { name: string }) {
  return (
    <span className="initials" aria-hidden="true">
      {initialsOf(name)}
    </span>
  )
}
