import type { Dict } from '../id';

export const voice: Dict['voice'] = {
  panel: {
    activeEngine: 'Active engine:',
    engines: {
      browser: 'Web Speech API (browser)',
      whisper: 'Local Whisper (offline once the model is downloaded)',
      none: 'not available',
    },
    desktopNote: 'The desktop app uses local Whisper.',

    language: 'Speech language',
    languageAuto: (name: string) => `Automatic (${name})`,
    languageAutoHint: 'Automatic follows the interface language.',
    languages: {
      'id-ID': 'Indonesian',
      'en-US': 'English (US)',
    },

    engine: 'Speech recognition engine',
    engineAuto: 'Automatic',
    engineBrowser: 'Web Speech API (Chrome/Edge)',
    engineWhisper: 'Local Whisper',

    whisperModel: 'Whisper model',
    whisperModels: {
      small: 'Whisper small - accurate (±250 MB, one-time download)',
      base: 'Whisper base - balanced (±80 MB)',
      tiny: 'Whisper tiny - lightest (±40 MB)',
    },
    whisperHint: 'The model is downloaded once from Hugging Face, then kept in the browser/app cache.',

    autoSend: 'Send automatically when I stop speaking',
    speakReplies: 'The character reads out a summary of the result (text-to-speech)',
    test: 'Test voice',
    testPhrase: 'Hi, I am SOLAR AI Agent, ready to help with your architecture design.',
  },

  recognition: {
    unsupported: 'Voice input is not supported on this device/browser.',
    fallbackToWhisper: (message: string) => `${message} Switching to local Whisper - click the microphone again.`,
    webSpeechUnavailable: 'The Web Speech API is not available in this browser.',
    micDenied: 'Microphone access was denied. Allow the microphone in your browser settings.',
    micNotFound: 'No microphone found.',
    micUnavailable: 'Microphone access was denied or no microphone is available.',
    serviceUnreachable: "The browser's speech recognition service cannot be reached.",
    failed: (code: string) => `Speech recognition failed (${code}).`,
    listening: 'Listening…',
    listeningUntilSilence: 'Listening… (stops automatically when you go quiet)',
    preparingModel: 'Preparing the speech model (one time only)…',
    downloadingModel: (percent: number) => `Downloading the speech model… ${percent}%`,
    transcribing: 'Transcribing…',
    transcriptionFailed: (reason: string) => `Transcription failed: ${reason}`,
  },
};
