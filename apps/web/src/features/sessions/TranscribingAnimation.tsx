/**
 * "Sound becomes text" while the transcript is made. Decorative: a fixed rhythm, never real
 * audio or loudness (CLAUDE.md rule 12). Still under reduced motion; the card's text carries
 * the status.
 */
export function TranscribingAnimation() {
  return (
    <span className="transcribing-animation" aria-hidden="true">
      <span className="transcribing-wave">
        <span />
        <span />
        <span />
        <span />
        <span />
      </span>
      <span className="transcribing-flow" />
      <span className="transcribing-lines">
        <span />
        <span />
        <span />
      </span>
    </span>
  )
}
