import { numEn, plural } from '../helpers';
import type { Dict } from '../id';

export const agent: Dict['agent'] = {
  greeting: "Hi! I'm SOLAR AI AGENT, your solution architect assistant. Type or say what you need.",

  quickPrompts: {
    fromDocuments: {
      label: 'From documents',
      text: 'Study all the attached documents, then create a complete architecture package based on them (ArchiMate model, sequence diagrams for the main and error scenarios, and a Technical Specification Document). Note any assumptions and open questions. Focus: ',
    },
    fullPackage: {
      label: 'Full package',
      text: 'Create a complete architecture package in one go: an ArchiMate model (Layered View and Application Cooperation View), sequence diagrams for the main scenario and the error flows, and a Technical Specification Document. System: ',
    },
    archimate: {
      label: 'ArchiMate diagram',
      text: 'Create an ArchiMate 3.2 model (Layered View) for the following system: ',
    },
    sequence: {
      label: 'Sequence diagram',
      text: 'Create a sequence diagram (happy path and error path) for the flow: ',
    },
    techSpec: {
      label: 'Technical Spec',
      text: 'Write a complete Technical Specification Document (TSD) for: ',
    },
    planeBacklog: {
      label: 'Plane backlog',
      text: 'Create a backlog in Plane (plane.mesthi.com) from the latest TSD: one epic per component, one story per functional requirement.',
    },
    publishGithub: {
      label: 'Publish to GitHub',
      text: 'Publish all artifacts of the latest task to GitHub in the folder docs/architecture/',
    },
  },

  speech: {
    connecting: 'Connecting to the SOLAR AI AGENT server…',
    llmMissing: 'The AI model is not ready yet',
    llmMissingSub: 'Set OPENAI_API_KEY in .env, or add a provider in Settings → AI models.',
    listening: "I'm listening…",
    listeningSub: "Go ahead and speak. I'll stop automatically when you go quiet.",
    done: 'Done! All deliverables are ready.',
    doneSub: 'See the artifacts in the conversation panel.',
    failed: 'Something went wrong…',
    failedSub: 'The error details are in the conversation and the monitor.',
    needsApproval: 'I need your approval',
    working: 'Working on it…',
    speaking: 'Summary of the result…',
    idleSub: 'Click me to start talking.',
  },

  chat: {
    title: 'Conversation',
    dropTitle: 'Drop to attach documents',
    dropFormats: 'PDF, Word, Excel, PowerPoint, Markdown or text',
    stopSpeaking: 'Stop speaking',
    newConversation: 'New conversation',
    newConversationTitle: 'Start a new conversation (the previous context is not carried over)',
    emptyTitle: 'Start with a single request.',
    emptyExample:
      'Example: “Create a complete architecture package for an online ordering system with payments through a payment gateway, deployed on Kubernetes, with a PostgreSQL database.”',
    emptyAttach: 'Have project documents? Attach PDF, Word, Excel, PowerPoint or Markdown files with the paperclip button, or drag them here.',
  },

  bubble: {
    costTitle: 'Estimated API cost',
    cancelTask: 'Cancel',
    progressLabel: (title: string) => `Progress of ${title}`,
    cancelled: 'Task cancelled.',
    steps: (n: number) => `Work steps (${numEn(n)})`,
    awaitingApproval: (action: string) => `Waiting for approval: ${action}`,
    approved: 'Approved',
    rejected: 'Rejected',
    rejectedWithNote: (note: string) => `Rejected (${note})`,
  },

  composer: {
    promptLabel: 'Request for SOLAR',
    placeholder: 'Type a request… (Enter to send, Shift+Enter for a new line)',
    placeholderWithFiles: 'What should I create from these documents?',
    micStart: 'Speak (voice input)',
    micStop: 'Stop listening',
    micTitle: 'Voice input',
    micTitleWhisper: 'Voice input (local Whisper)',
    micUnavailable: 'Voice input is not available',
    attachLabel: 'Attach documents',
    attachTitle: (maxMb: number, maxFiles: number) =>
      `Attach project documents: PDF, Word, Excel, PowerPoint, Markdown, text (max ${numEn(maxMb)} MB, ${numEn(maxFiles)} ${plural(maxFiles, 'file')}). You can also drag files into the conversation.`,
    attachmentsLabel: 'Attachments for this request',
    listening: 'Listening…',
    readingAttachments: 'Reading the attached documents…',
    waitForAttachments: 'Wait until all attachments have been read.',
    uploading: (percent: number) => `Uploading ${percent}%`,
    reading: 'Reading…',
    legacyFormat: (ext: string, modern: string) => `The old ${ext} format is not supported yet - save it again as ${modern} or PDF.`,
    unsupportedType: 'Unsupported file type. Use PDF, Word (.docx), Excel (.xlsx/.csv), PowerPoint (.pptx), Markdown or .txt.',
    emptyFile: 'The file is empty.',
    tooLarge: (maxMb: number) => `Too large (max ${numEn(maxMb)} MB).`,
    tooMany: (max: number) => `At most ${numEn(max)} ${plural(max, 'attachment')} per request.`,
  },

  attachments: {
    pages: (n: number) => `${numEn(n)} ${plural(n, 'page')}`,
    slides: (n: number) => `${numEn(n)} ${plural(n, 'slide')}`,
    sheets: (n: number) => `${numEn(n)} ${plural(n, 'sheet')}`,
    warning: 'Warning',
    open: (name: string) => `View the contents of ${name}`,
    remove: (name: string) => `Remove attachment ${name}`,
    download: (name: string) => `Download ${name}`,
    stripLabel: 'Attached documents',
    placeholderName: 'Attachment',
    loadingList: 'Loading attachments…',
    viewText: 'View text',
    originalFile: 'Original file',
    previewNote: 'this extracted text is exactly what the agent reads.',
    viewLabel: 'Text view',
    formatted: 'Formatted',
    raw: 'Raw text',
    loadingText: 'Loading text…',
    truncated: '… (preview truncated; the agent still reads the whole text)',
    page: (n: string) => `Page ${n}`,
    pagesNotRead: (from: string, to: string) => `Pages ${from}-${to} were not read (document length limit)`,
  },

  confirmation: {
    badge: 'Needs your approval',
    more: (n: number) => `+${numEn(n)} more ${plural(n, 'request')}`,
    plugin: (name: string) => `Plugin: ${name}`,
    task: (title: string) => `Task: ${title}`,
    data: 'Data to be sent',
    noteLabel: 'Note for SOLAR (optional)',
    notePlaceholder: "e.g. only use the 'Order Platform' project",
    approve: 'Approve & continue',
  },

  markdown: {
    image: 'image',
    imageWithAlt: (alt: string) => `image: ${alt}`,
  },
};
