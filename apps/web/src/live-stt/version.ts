/** Must match VERSION in scripts/build-live-stt.mjs (a test checks this). */
export const LIVE_STT_VERSION = 'sherpa-1.13.7-kroko-2025-08-06-de-en'
/** Languages with an in-browser model. Other clients get the server text only. */
export const LIVE_STT_LANGUAGES = ['de', 'en'] as const
export type LiveSttLanguage = (typeof LIVE_STT_LANGUAGES)[number]
