/**
 * The app shell: page metadata, access-token gate, "new version" notice, top bar, language switch, settings drawer
 * and the status badge / progress meter (App.tsx, TopBar.tsx, SettingsDrawer.tsx, Status.tsx).
 */
export const app = {
  meta: {
    /** <meta name="description">; the English one is used while the interface is in English. */
    description:
      'SOLAR AI AGENT - asisten AI solution architect dengan karakter 3D (Robo, Mochi, Cocoa Kelapa, Kelinci): ArchiMate, sequence diagram dan Technical Specification Document.',
  },

  tokenGate: {
    title: 'Token akses diperlukan',
    hint: 'Server SOLAR ini dilindungi SOLAR_ACCESS_TOKEN. Masukkan token untuk melanjutkan.',
    tokenLabel: 'Token akses',
    submit: 'Masuk',
  },

  update: {
    available: 'Versi baru SOLAR AI AGENT tersedia.',
  },

  topbar: {
    tagline: 'Solution Architect',
    navLabel: 'Navigasi utama',
    agent: 'Agent',
    monitor: 'Monitor',
    /** Monitor tab with the number of approval requests waiting for an answer. */
    monitorWaiting: (n: number) => `Monitor (${n})`,
    monitorWaitingLabel: (n: number) => `Monitor, ${n} persetujuan menunggu`,
    connected: 'Terhubung',
    disconnected: 'Terputus',
    install: 'Pasang aplikasi',
    installTitle: 'Pasang SOLAR AI AGENT sebagai aplikasi',
    lightTheme: 'Tema terang',
    darkTheme: 'Tema gelap',
    settings: 'Pengaturan',
  },

  /** The interface language switch (top bar and Settings → Sistem). */
  language: {
    /** Bilingual on purpose: whoever cannot read the current language still finds the switch. */
    label: 'Bahasa / Language',
    hint: 'Berlaku langsung di seluruh aplikasi dan disimpan di perangkat ini. Agent menjawab dalam bahasa permintaan Anda.',
  },

  settings: {
    title: 'Pengaturan',
    tabs: {
      character: 'Karakter',
      models: 'Model AI',
      knowledge: 'Knowledge',
      skills: 'Skills',
      plugins: 'Plugin MCP',
      voice: 'Suara',
      system: 'Sistem',
    },
    characterIntro:
      'Pilih tampilan SOLAR AI AGENT. Animasinya sama untuk semua karakter: mendengarkan, berpikir, bekerja, berbicara, bertanya, senang dan sedih. Pilihan disimpan di perangkat ini.',
  },

  status: {
    progress: 'Progres',
  },
};
