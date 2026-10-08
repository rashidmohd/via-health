import { bookmarkCapture, detectCaptures } from './detectors'

function kinds(text: string, terms: string[] = []): string[] {
  return detectCaptures([{ text, start_ms: 1000 }], terms).map((c) => c.kind)
}

describe('capture detectors', () => {
  it.each([
    'Schreiben Sie bis nächste Woche Ihre Gedanken auf.',
    'Versuchen Sie, jeden Abend Ihre Gedanken aufzuschreiben.',
    'Bitte üben Sie die Atemübung täglich.',
    'Probieren Sie das bis zum nächsten Mal aus.',
    'Try to write it down every evening.',
    'Please practise the breathing exercise by next week.',
  ])('finds a task: %s', (sentence) => {
    expect(kinds(sentence)).toEqual(['action_item'])
  })

  it.each([
    'Ich schreibe nie etwas auf, bis nächste Woche nicht.',
    'Ich habe jeden Abend alles aufgeschrieben.', // past: a report, not a task
    'Ich habe die Übungen jeden Abend gemacht.',
    'I never write things down every day.',
    'Ich lese gern.', // task verb without time
    'Bis nächste Woche!', // time without task
  ])('ignores: %s', (sentence) => {
    expect(kinds(sentence)).not.toContain('action_item')
  })

  it.each([
    'Wir sehen uns Donnerstag, gleiche Zeit.',
    'Der nächste Termin ist am 14. um 15 Uhr.',
    'See you next Tuesday at 3 pm.',
    'Our next session is on the 14th.',
  ])('finds an appointment: %s', (sentence) => {
    expect(kinds(sentence)).toContain('date')
  })

  it.each([
    'Am Donnerstag war ich sehr müde.',
    'Am Donnerstag hatte ich einen Streit mit meinem Bruder.',
    'On Monday I was tired.',
  ])('ignores past events: %s', (sentence) => {
    expect(kinds(sentence)).not.toContain('date')
  })

  it('finds terms from the practice list, as whole words only', () => {
    expect(kinds('Wir sprechen über Schlafhygiene.', ['Schlafhygiene'])).toEqual(['term'])
    expect(kinds('Hygiene ist wichtig.', ['Schlafhygiene'])).toEqual([])
    expect(kinds('Übungen helfen.', ['Übung'])).toEqual([])
  })

  it('splits segments into sentences with stable keys', () => {
    const found = detectCaptures([
      { text: 'Danke. Schreiben Sie bis nächste Woche alles auf. Wir sehen uns Donnerstag.', start_ms: 61_000 },
    ])
    expect(found.map((c) => c.key)).toEqual(['action_item:61000:1', 'date:61000:2'])
    expect(found[0].text).toBe('Schreiben Sie bis nächste Woche alles auf.')
  })

  it('never produces mood, emotion or risk chips', () => {
    const all = detectCaptures([
      { text: 'Ich bin so traurig und wütend, ich halte das nicht mehr aus.', start_ms: 0 },
      { text: 'I feel hopeless and anxious.', start_ms: 0 },
    ])
    expect(all).toEqual([])
  })

  it('makes bookmarks', () => {
    expect(bookmarkCapture(5000)).toEqual({ kind: 'bookmark', text: '', atMs: 5000, key: 'bookmark:5000' })
  })
})
