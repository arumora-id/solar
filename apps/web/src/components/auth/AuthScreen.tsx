import gsap from 'gsap';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AuthMe } from '@solar/shared';
import { announce } from '../../lib/announce';
import { useAuth } from '../../lib/auth';
import { formatClock } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { pressHandlers, reducedMotion, shake } from '../../lib/motion';
import { AlertIcon, BanIcon, CheckCircleIcon, ClockIcon, RefreshIcon } from '../Icons';
import { ThemeToggle } from '../ThemeToggle';
import { LanguageSwitch } from '../TopBar';
import { AuthScreenContext, LoginForm, RegisterForm, SetupForm, type AuthScreenApi, type AuthView, type RoboMood } from './AuthForms';
import { DEFAULT_POLICY } from './fields';
import { Robo, type RoboHandle } from './Robo';

/** Views ordered left to right: a switch slides the new one in from the side it lies on. */
const ORDER: AuthView[] = ['login', 'pending', 'disabled', 'register', 'registered', 'setup'];

/**
 * The screens before the app: login, registration (and its "sent" page), first-superadmin setup, "account waiting for
 * approval", "account disabled" and "server unreachable". Robo stands next to the form on wide screens and above it
 * on phones; GSAP plays the entrance, the switch between views (the card morphs to the new height), the error shake
 * and the success transition into the app - none of it with "reduce motion".
 */
export function AuthScreen() {
  const auth = useAuth();
  const t = useT();
  const policy = auth.authState?.passwordPolicy ?? DEFAULT_POLICY;
  const setupRequired = auth.authState?.setupRequired ?? false;
  const unreachable = auth.status === 'unreachable';

  const [view, setView] = useState<AuthView>(setupRequired ? 'setup' : 'login');
  const [identifier, setIdentifier] = useState<string | undefined>(undefined);
  const [registeredAs, setRegisteredAs] = useState('');
  const [mood, setMoodState] = useState<RoboMood>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const roboRef = useRef<RoboHandle>(null);
  const roboWrapRef = useRef<HTMLDivElement>(null);
  const morphFrom = useRef<number | null>(null);
  const direction = useRef(1);
  const moodTimer = useRef<number | undefined>(undefined);
  const leaving = useRef(false);

  // the setup was finished elsewhere (or the server was reset): show the matching form
  useEffect(() => {
    if (setupRequired && view !== 'setup') setView('setup');
    else if (!setupRequired && view === 'setup') {
      setView('login');
      auth.showNotice('setupDone');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupRequired]);

  useEffect(() => () => window.clearTimeout(moodTimer.current), []);

  const setMood = useCallback((next: RoboMood) => {
    window.clearTimeout(moodTimer.current);
    setMoodState(next);
  }, []);

  // entrance
  useLayoutEffect(() => {
    if (reducedMotion()) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.from(roboWrapRef.current, { y: 30, scale: 0.82, opacity: 0, duration: 0.75, ease: 'back.out(1.6)', clearProps: 'all' }, 0)
        .from(bubbleRef.current, { scale: 0.6, opacity: 0, duration: 0.45, ease: 'back.out(2.2)', clearProps: 'all' }, 0.45)
        .from('.auth-pitch > *', { y: 14, opacity: 0, stagger: 0.08, duration: 0.5, clearProps: 'all' }, 0.2)
        .from(cardRef.current, { y: 28, opacity: 0, duration: 0.6, clearProps: 'all' }, 0.08)
        .from(cardRef.current?.querySelectorAll('[data-anim="field"]') ?? [], { y: 12, opacity: 0, stagger: 0.045, duration: 0.42, clearProps: 'all' }, 0.28);
    }, rootRef);
    return () => ctx.revert();
  }, []);

  const go = useCallback<AuthScreenApi['go']>(
    (next, options) => {
      if (options?.identifier !== undefined) setIdentifier(options.identifier);
      if (options?.username) setRegisteredAs(options.username);
      if (next === 'login' && view === 'login') return;
      setMood(null);
      roboRef.current?.shy(false);
      direction.current = ORDER.indexOf(next) >= ORDER.indexOf(view) ? 1 : -1;
      const content = viewRef.current;
      if (reducedMotion() || !content || !cardRef.current) {
        setView(next);
        return;
      }
      morphFrom.current = cardRef.current.offsetHeight;
      gsap.to(content, { opacity: 0, x: -direction.current * 22, duration: 0.16, ease: 'power2.in', onComplete: () => setView(next) });
    },
    [view, setMood],
  );

  // after a switch: the card morphs from the old height to the new one while the new view slides in
  const firstView = useRef(true);
  useLayoutEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    const card = cardRef.current;
    const content = viewRef.current;
    // the heading first (screen readers learn where they are); a form then focuses its first field itself
    content?.querySelector<HTMLElement>('#auth-title')?.focus({ preventScroll: true });
    const from = morphFrom.current;
    morphFrom.current = null;
    if (!card || !content || from === null || reducedMotion()) return;
    const to = card.offsetHeight;
    const tl = gsap.timeline();
    tl.fromTo(card, { height: from }, { height: to, duration: 0.42, ease: 'power3.inOut', clearProps: 'height' }, 0)
      .fromTo(content, { opacity: 0, x: direction.current * 28 }, { opacity: 1, x: 0, duration: 0.4, ease: 'power3.out', clearProps: 'opacity,transform' }, 0.06)
      .from(content.querySelectorAll('[data-anim="field"]'), { opacity: 0, y: 10, stagger: 0.03, duration: 0.3, ease: 'power2.out', clearProps: 'opacity,transform' }, 0.1);
    return () => {
      tl.kill();
      gsap.set([card, content], { clearProps: 'height,opacity,transform' });
    };
  }, [view]);

  const fail = useCallback<AuthScreenApi['fail']>(
    (target) => {
      setMood('error');
      roboRef.current?.oops();
      shake(target && (!Array.isArray(target) || target.length) ? target : cardRef.current);
      // back to the line that fits the moment: still in a password field, Robo still looks away
      moodTimer.current = window.setTimeout(() => {
        const inPassword = document.activeElement instanceof HTMLElement && Boolean(document.activeElement.closest('.pw-wrap'));
        setMoodState((m) => (m === 'error' ? (inPassword ? 'password' : null) : m));
      }, 2600);
    },
    [setMood],
  );

  const succeed = useCallback<AuthScreenApi['succeed']>(
    (me: AuthMe) => {
      if (leaving.current) return;
      leaving.current = true;
      // the other tabs of this browser follow at once (they share the session cookie)
      auth.announceLogin(me);
      const name = me.user?.name ?? t.auth.menu.tokenUser;
      setMood({ welcome: name });
      // the login screen goes away with the focus in it: say where the user is going
      announce(`${t.auth.say.welcome(name)} ${t.auth.entering}`);
      roboRef.current?.cheer();
      if (reducedMotion()) {
        auth.enter(me);
        return;
      }
      // short: it is played at every login (Robo's cheer and greeting are seen while the form fades)
      const tl = gsap.timeline({ onComplete: () => auth.enter(me) });
      tl.to(viewRef.current, { opacity: 0, y: -12, duration: 0.22, ease: 'power2.in' }, 0)
        .to(cardRef.current, { opacity: 0, scale: 0.96, duration: 0.26, ease: 'power2.in' }, 0.1)
        .to(rootRef.current, { opacity: 0, duration: 0.24, ease: 'power1.in' }, 0.32);
    },
    [auth, setMood, t],
  );

  const api = useMemo<AuthScreenApi>(() => ({ policy, robo: roboRef, setMood, fail, go, succeed }), [policy, setMood, fail, go, succeed]);

  const say = t.auth.say;
  const speech =
    mood === 'error'
      ? say.error
      : mood === 'password'
        ? say.password
        : mood
          ? say.welcome(mood.welcome)
          : unreachable
            ? say.unreachable
            : say[view];

  // Robo speaks: the mouth moves and the bubble pops
  const lastSpeech = useRef(speech);
  useEffect(() => {
    if (lastSpeech.current === speech) return;
    lastSpeech.current = speech;
    roboRef.current?.talk();
    if (!reducedMotion() && bubbleRef.current) {
      gsap.fromTo(bubbleRef.current, { scale: 0.9, opacity: 0.4 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2.4)', clearProps: 'all' });
    }
  }, [speech]);

  let content: ReactNode;
  if (unreachable) content = <UnreachableView />;
  else if (view === 'login') content = <LoginForm initialIdentifier={identifier} />;
  else if (view === 'register') content = <RegisterForm />;
  else if (view === 'setup') content = <SetupForm />;
  else content = <StatusView view={view} username={registeredAs} onBack={() => go('login')} />;

  return (
    <AuthScreenContext.Provider value={api}>
      <div className="auth" ref={rootRef}>
        <div className="auth-toolbar">
          <LanguageSwitch />
          <ThemeToggle />
        </div>
        <aside className="auth-hero">
          <div className="auth-brand">
            <img src="/favicon.svg" alt="" width={28} height={28} />
            <span>SOLAR AI AGENT</span>
          </div>
          <div className="auth-stage">
            <div className="auth-speech" ref={bubbleRef} aria-hidden="true">
              {speech}
            </div>
            <div className="auth-robo" ref={roboWrapRef}>
              <Robo ref={roboRef} label={t.auth.hero.robotLabel} />
            </div>
          </div>
          <div className="auth-pitch">
            <p className="auth-tagline">{t.auth.hero.tagline}</p>
            <ul>
              <li>{t.auth.hero.pointDiagrams}</li>
              <li>{t.auth.hero.pointDocuments}</li>
              <li>{t.auth.hero.pointKnowledge}</li>
            </ul>
          </div>
        </aside>
        <main className="auth-main">
          <div className="auth-card" ref={cardRef}>
            <div className="auth-view" ref={viewRef} key={unreachable ? 'unreachable' : view}>
              {content}
            </div>
          </div>
          {auth.authState && (
            <p className="auth-foot">
              {auth.authState.appName} {auth.authState.version}
            </p>
          )}
        </main>
      </div>
    </AuthScreenContext.Provider>
  );
}

function StatusView({ view, username, onBack }: { view: Exclude<AuthView, 'login' | 'register' | 'setup'>; username: string; onBack: () => void }) {
  const t = useT();
  const back = (label: string) => (
    <button type="button" className="btn primary auth-submit" onClick={onBack} data-anim="field" {...pressHandlers()}>
      {label}
    </button>
  );
  if (view === 'registered') {
    const words = t.auth.registered;
    return (
      <div className="auth-status" data-tone="good">
        <div className="auth-status-icon" data-anim="field">
          <CheckCircleIcon size={28} />
        </div>
        <h2 id="auth-title" tabIndex={-1} data-anim="field">
          {words.title}
        </h2>
        <p data-anim="field">{words.body(username)}</p>
        <ol className="auth-steps" data-anim="field">
          <li>{words.step1}</li>
          <li>{words.step2}</li>
          <li>{words.step3}</li>
        </ol>
        {back(words.back)}
      </div>
    );
  }
  const words = view === 'pending' ? t.auth.pending : t.auth.disabled;
  return (
    <div className="auth-status" data-tone={view === 'pending' ? 'wait' : 'bad'}>
      <div className="auth-status-icon" data-anim="field">
        {view === 'pending' ? <ClockIcon size={28} /> : <BanIcon size={28} />}
      </div>
      <h2 id="auth-title" tabIndex={-1} data-anim="field">
        {words.title}
      </h2>
      <p data-anim="field">{words.body}</p>
      {back(words.back)}
    </div>
  );
}

function UnreachableView() {
  const t = useT();
  const { reload } = useAuth();
  const [busy, setBusy] = useState(false);
  /** When the last retry failed (the screen would otherwise look exactly the same). */
  const [failedAt, setFailedAt] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const retry = () => {
    if (busy) return;
    setBusy(true);
    void reload().finally(() => {
      // still here: the server is still unreachable (on success this view is gone)
      if (!mounted.current) return;
      setBusy(false);
      setFailedAt(new Date().toISOString());
    });
  };
  return (
    <div className="auth-status" data-tone="bad">
      <div className="auth-status-icon" data-anim="field">
        <AlertIcon size={28} />
      </div>
      <h2 id="auth-title" tabIndex={-1} data-anim="field">
        {t.auth.unreachable.title}
      </h2>
      <p data-anim="field">{t.auth.unreachable.body}</p>
      {/* marked busy instead of disabled: the focus stays on the button while it tries */}
      <button type="button" className="btn primary auth-submit" aria-disabled={busy || undefined} aria-busy={busy || undefined} data-anim="field" onClick={retry} {...pressHandlers()}>
        <RefreshIcon size={16} className={busy ? 'spin' : undefined} /> {t.auth.unreachable.retry}
      </button>
      <p className="auth-retry-note" role="status" data-anim="field">
        {failedAt && !busy ? t.auth.unreachable.stillDown(formatClock(failedAt)) : ''}
      </p>
    </div>
  );
}

/** While GET /api/auth/state is on its way: Robo alone (appears only if it takes a moment). */
export function AuthSplash() {
  const t = useT();
  return (
    <div className="auth-splash" role="status" aria-label={t.auth.loading}>
      <img src="/characters/robot.svg" alt="" width={96} height={96} />
      <span>{t.auth.loading}</span>
    </div>
  );
}
