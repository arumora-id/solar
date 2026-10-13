import { numEn, plural } from '../helpers';
import type { Dict } from '../id';

export const auth: Dict['auth'] = {
  hero: {
    tagline: 'AI Solution Architect assistant',
    pointDiagrams: 'ArchiMate models and sequence diagrams',
    pointDocuments: 'Technical Specification Documents, ready as Word',
    pointKnowledge: 'A knowledge base and skills shared by the team',
    robotLabel: 'Robo, the SOLAR AI AGENT mascot',
  },

  say: {
    login: "Hi! I'm Robo. Log in to get started.",
    register: 'Nice to meet you! Tell me a bit about yourself.',
    registered: 'I have received your registration.',
    setup: "A brand-new server! Let's create the first superadmin.",
    pending: 'Your account is still being reviewed.',
    disabled: 'This account is disabled.',
    unreachable: "I can't reach the server yet.",
    error: "Hmm, something isn't quite right.",
    password: "Don't worry, I'm not peeking.",
    welcome: (name: string) => `Welcome, ${name}!`,
  },

  fields: {
    identifier: 'Username or email',
    identifierPlaceholder: 'jane.doe or jane@company.com',
    username: 'Username',
    usernameHint: '3-32 characters: lower-case letters a-z, digits, dot (.), underscore (_) or dash (-).',
    usernamePlaceholder: 'jane.doe',
    email: 'Email',
    emailPlaceholder: 'jane@company.com',
    name: 'Display name',
    nameHint: 'The name your colleagues see in SOLAR.',
    namePlaceholder: 'Jane Doe',
    password: 'Password',
    newPassword: 'New password',
    confirmPassword: 'Repeat password',
    currentPassword: 'Current password',
    setupCode: 'Setup code',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    capsLock: 'Caps Lock is on',
    remember: 'Remember my username/email on this device',
  },

  login: {
    title: 'Log in to SOLAR',
    subtitle: 'Use the username or email and the password of your account.',
    submit: 'Log in',
    submitting: 'Checking…',
    waitButton: (time: string) => `Try again in ${time}`,
    noAccount: "Don't have an account?",
    register: 'Register now',
    forgot: 'Forgot your password? Ask a superadmin to reset it.',
  },

  notice: {
    loggedOut: 'You have logged out. See you soon!',
    sessionEnded: 'Your session has ended. Please log in again to continue.',
    setupDone: 'The first superadmin has been created. Please log in.',
  },

  errors: {
    invalidCredentials: 'Wrong username/email or password.',
    rateLimited: (time: string) => `Too many attempts. Try again in ${time}.`,
    rateLimitedWait: 'Too many attempts. The button below works again when its countdown ends.',
    registerRateLimited:
      'Many registrations have come from this network in the past hour. The Register button works again when its countdown ends, or ask a superadmin to create an account for you.',
    busy: 'The server is busy checking many logins. Try again in a few seconds.',
    required: 'Required.',
    usernameFormat: "This username doesn't match the required format.",
    emailFormat: 'Not a valid email address.',
    nameLength: 'The display name has 1-80 characters.',
    passwordShort: (min: number) => `At least ${numEn(min)} characters.`,
    passwordLong: (max: number) => `At most ${numEn(max)} characters.`,
    passwordBlank: 'The password must not be only spaces.',
    passwordSameAsIdentity: 'The password must not be the username or the email address.',
    mismatch: 'The passwords do not match.',
    usernameTaken: 'This username is taken. Please choose another one.',
    emailTaken: 'This email is already registered. Log in, or ask a superadmin to reset your password.',
    registrationClosed: 'Registration opens once the first superadmin has been created.',
    setupCodeInvalid: 'Wrong setup code. Check the server log or the setup-code.txt file again.',
    setupForbidden: 'The first superadmin can only be created on the computer that runs the SOLAR server (localhost).',
    wrongPassword: 'The current password is wrong.',
    fixFields: 'Please check the highlighted fields.',
  },

  time: {
    seconds: (s: number) => `${numEn(s)} ${plural(s, 'second')}`,
    minutes: (m: number) => `${numEn(m)} ${plural(m, 'minute')}`,
    minutesSeconds: (m: number, s: number) => `${numEn(m)} ${plural(m, 'minute')} ${numEn(s)} ${plural(s, 'second')}`,
  },

  register: {
    title: 'Create an account',
    subtitle: 'Register yourself, then wait for approval.',
    submit: 'Register',
    submitting: 'Sending your registration…',
    haveAccount: 'Already have an account?',
    login: 'Log in',
    nextTitle: 'What happens next',
    next: 'Your account waits for approval by a Superadmin or the Head of IT Solar. You can log in as soon as it is approved.',
    closed: 'Registration is not open yet: the first superadmin has not been created.',
  },

  registered: {
    title: 'Registration sent',
    body: (username: string) => `The account "${username}" has been created and is now waiting for approval.`,
    step1: 'A Superadmin or the Head of IT Solar reviews your registration.',
    step2: 'Once approved, log in with the username or email and the password you just chose.',
    step3: 'In a hurry? Contact the Head of IT Solar.',
    back: 'Go to the login page',
  },

  pending: {
    title: 'Account waiting for approval',
    body: 'Your password is correct, but this account has not been approved yet. A Superadmin or the Head of IT Solar will review it; then you can log in right away.',
    back: 'Back to the login page',
  },

  disabled: {
    title: 'Account disabled',
    body: 'This account is disabled, so it cannot be used to log in. Contact a superadmin or the Head of IT Solar if you think this is a mistake.',
    back: 'Back to the login page',
  },

  setup: {
    title: 'Set up SOLAR',
    subtitle: 'There is no account on this server yet. Create the first superadmin; other people can register afterwards.',
    submit: 'Create superadmin and log in',
    submitting: 'Setting up…',
    codeHint:
      'A one-time code (XXXX-XXXX-XXXX-XXXX) printed in the server log when SOLAR starts and stored in setup-code.txt in the SOLAR data folder. Upper/lower case, spaces and dashes do not matter.',
    codePrefilled: 'Filled in by the desktop app.',
    codeRefreshed: 'That setup code is no longer valid. The desktop app has filled in the current one: submit again.',
    codePlaceholder: 'XXXX-XXXX-XXXX-XXXX',
    localOnly: 'The setup only works on the computer that runs the SOLAR server.',
    roleNote: 'The superadmin has full access: user accounts, AI models, MCP plugins and configuration.',
  },

  unreachable: {
    title: 'Server unreachable',
    body: 'SOLAR cannot reach the server. Make sure the server is running and the network is connected, then try again.',
    retry: 'Try again',
    stillDown: (time: string) => `The server is still unreachable (tried at ${time}).`,
  },

  loading: 'Getting SOLAR ready…',

  strength: {
    label: 'Password strength',
    level0: 'Too short',
    level1: 'Weak',
    level2: 'Fair',
    level3: 'Good',
    level4: 'Strong',
    tip: 'A long sentence you can remember is stronger than a short, complicated word.',
  },

  policy: {
    label: 'Password rules',
    length: (min: number, max: number) => `${numEn(min)}-${numEn(max)} characters`,
    notIdentity: 'Not the username or the email address',
    match: 'Both passwords match',
    met: 'met',
    notMet: 'not met yet',
  },

  menu: {
    button: (name: string) => `Account: ${name}`,
    signedInAs: 'Logged in as',
    changePassword: 'Change password',
    logout: 'Log out',
    logoutUnreachable: 'Could not log out: the server could not be reached. You are still logged in on this device; try again.',
    logoutFailed: 'Could not log out. You are still logged in on this device; try again in a moment.',
    tokenUser: 'Access token (SOLAR_ACCESS_TOKEN)',
  },

  changePassword: {
    title: 'Change password',
    intro: 'Once changed, your sessions on other devices end; this one stays logged in.',
    submit: 'Save new password',
    done: 'Password changed. Your sessions on other devices have ended.',
    sameAsCurrent: 'The new password must differ from the current one.',
  },

  pendingBadge: {
    label: (n: number) => `${numEn(n)} ${plural(n, 'registration')} waiting for approval`,
    title: 'Open the registrations waiting for approval',
  },

  entering: 'Entering SOLAR…',
};
