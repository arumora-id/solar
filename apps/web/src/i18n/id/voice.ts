/**
 * Voice: components/settings/VoicePanel.tsx and voice/useVoice.ts, voice/recognition.ts, voice/tts.ts (speech input
 * and the character reading results aloud).
 */
export const voice = {
  /** Settings → Suara. */
  panel: {
    activeEngine: 'Mesin aktif:',
    engines: {
      browser: 'Web Speech API (browser)',
      whisper: 'Whisper lokal (offline setelah unduh model)',
      none: 'tidak tersedia',
    },
    desktopNote: 'Aplikasi desktop memakai Whisper lokal.',

    language: 'Bahasa suara',
    /** `name`: the language the interface is in now (common.languageName). Short: it is the text of a select. */
    languageAuto: (name: string) => `Otomatis (${name})`,
    languageAutoHint: '“Otomatis” mengikuti bahasa tampilan.',
    /** Speech languages (BCP 47 tags, as stored in the voice preferences). */
    languages: {
      'id-ID': 'Bahasa Indonesia',
      'en-US': 'Bahasa Inggris (AS)',
    },

    engine: 'Mesin pengenalan suara',
    engineAuto: 'Otomatis',
    engineBrowser: 'Web Speech API (Chrome/Edge)',
    engineWhisper: 'Whisper lokal',

    whisperModel: 'Model Whisper',
    whisperModels: {
      small: 'Whisper small - akurat (±250 MB, sekali unduh)',
      base: 'Whisper base - seimbang (±80 MB)',
      tiny: 'Whisper tiny - paling ringan (±40 MB)',
    },
    whisperHint: 'Model diunduh sekali dari Hugging Face lalu disimpan di cache browser/aplikasi.',

    autoSend: 'Kirim otomatis setelah selesai bicara',
    speakReplies: 'Karakter membacakan ringkasan hasil (text-to-speech)',
    test: 'Tes suara',
    /** Spoken by "Tes suara" when the speech language is Indonesian (the English dictionary has the English one). */
    testPhrase: 'Halo, saya SOLAR AI Agent. Siap membantu desain arsitektur Anda.',
  },

  /** Status and error lines under the composer while listening (voice/recognition.ts, voice/useVoice.ts). */
  recognition: {
    unsupported: 'Input suara tidak didukung di perangkat/browser ini.',
    /** `message`: why the browser engine failed (one of the texts below). */
    fallbackToWhisper: (message: string) => `${message} Beralih ke Whisper lokal - klik mikrofon lagi.`,
    webSpeechUnavailable: 'Web Speech API tidak tersedia di browser ini.',
    micDenied: 'Akses mikrofon ditolak. Izinkan mikrofon di pengaturan browser.',
    micNotFound: 'Mikrofon tidak ditemukan.',
    micUnavailable: 'Akses mikrofon ditolak atau mikrofon tidak tersedia.',
    serviceUnreachable: 'Layanan pengenalan suara browser tidak dapat dihubungi.',
    /** `code`: the browser's error code, e.g. "language-not-supported". */
    failed: (code: string) => `Pengenalan suara gagal (${code}).`,
    listening: 'Mendengarkan…',
    listeningUntilSilence: 'Mendengarkan… (berhenti otomatis saat hening)',
    preparingModel: 'Menyiapkan model suara (sekali saja)…',
    downloadingModel: (percent: number) => `Mengunduh model suara… ${percent}%`,
    transcribing: 'Mentranskripsi…',
    transcriptionFailed: (reason: string) => `Transkripsi gagal: ${reason}`,
  },
};
