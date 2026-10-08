/** Must match VERSION in scripts/build-live-stt.mjs (a test checks this). */
export const LIVE_STT_VERSION = 'sherpa-1.13.7-de-kroko-2025-08-06'
/** Languages with an in-browser model. Other clients get the server text only. */
export const LIVE_STT_LANGUAGES = ['de'] as const
