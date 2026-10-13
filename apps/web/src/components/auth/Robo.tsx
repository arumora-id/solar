import gsap from 'gsap';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { reducedMotion, useReducedMotion } from '../../lib/motion';

/**
 * Robo, SOLAR's default character, as a light inline SVG (the drawing of public/characters/robot.svg, split into parts
 * that move) for the login screens: it floats, its antennas glow and its eyes blink; it looks at what is typed, closes
 * its eyes while a password is typed, cheers on success and shakes its head on an error. With "reduce motion" it stays
 * still and only changes its face.
 */
export interface RoboHandle {
  /** Looks left/right (-1..1) and up/down (-1..1). */
  look(x: number, y?: number): void;
  /** Eyes closed (a password is being typed). */
  shy(on: boolean): void;
  /** Success: a hop, happy eyes, bright antennas. */
  cheer(): void;
  /** Something went wrong: a head shake and a red flash in the eyes. */
  oops(): void;
  /** Moves its mouth briefly (its speech bubble changed). */
  talk(): void;
}

const EYE = '#7fe4ff';
const EYE_ERROR = '#ff8a8a';

export const Robo = forwardRef<RoboHandle, { label: string; className?: string }>(function Robo({ label, className }, ref) {
  const reduce = useReducedMotion();
  const svg = useRef<SVGSVGElement>(null);
  const body = useRef<SVGGElement>(null);
  const head = useRef<SVGGElement>(null);
  const shadow = useRef<SVGEllipseElement>(null);
  const eyes = useRef<SVGGElement>(null);
  const eyeShapes = useRef<SVGGElement>(null);
  const happyEyes = useRef<SVGGElement>(null);
  const mouth = useRef<SVGPathElement>(null);
  const glows = useRef<SVGGElement>(null);
  const tips = useRef<SVGGElement>(null);
  const earL = useRef<SVGRectElement>(null);
  const earR = useRef<SVGRectElement>(null);
  const shyRef = useRef(false);

  // idle: float, glowing antennas, blinking
  useEffect(() => {
    if (reduce) return;
    const ctx = gsap.context(() => {
      gsap.to(body.current, { y: -1.8, duration: 2.2, ease: 'sine.inOut', yoyo: true, repeat: -1 });
      gsap.to(shadow.current, { scaleX: 0.86, opacity: 0.08, duration: 2.2, ease: 'sine.inOut', yoyo: true, repeat: -1, transformOrigin: '50% 50%' });
      gsap.fromTo(
        glows.current?.children ?? [],
        { opacity: 0.2, scale: 0.8 },
        { opacity: 0.75, scale: 1.25, duration: 1.1, ease: 'sine.inOut', yoyo: true, repeat: -1, stagger: 0.35, transformOrigin: '50% 50%' },
      );
    }, svg);
    let timer: gsap.core.Tween | null = null;
    const blink = () => {
      if (!shyRef.current && eyeShapes.current) {
        gsap.fromTo(eyeShapes.current, { scaleY: 1 }, { scaleY: 0.08, duration: 0.08, yoyo: true, repeat: 1, ease: 'power1.inOut', transformOrigin: '50% 50%' });
      }
      timer = gsap.delayedCall(2.2 + Math.random() * 3, blink);
    };
    timer = gsap.delayedCall(1.4, blink);
    return () => {
      timer?.kill();
      ctx.revert();
    };
  }, [reduce]);

  useImperativeHandle(
    ref,
    () => ({
      look(x, y = 0) {
        const clamp = (v: number) => Math.max(-1, Math.min(1, v));
        const vars = { x: clamp(x) * 2.4, y: clamp(y) * 1.4 };
        if (reducedMotion()) gsap.set(eyes.current, vars);
        else gsap.to(eyes.current, { ...vars, duration: 0.25, ease: 'power2.out', overwrite: 'auto' });
      },
      shy(on) {
        if (shyRef.current === on) return;
        shyRef.current = on;
        const eyeVars = on ? { scaleY: 0.1, y: 0.8 } : { scaleY: 1, y: 0 };
        const headVars = { rotation: on ? -5 : 0 };
        if (reducedMotion()) {
          gsap.set(eyeShapes.current, { ...eyeVars, transformOrigin: '50% 50%' });
          return;
        }
        gsap.to(eyeShapes.current, { ...eyeVars, duration: 0.22, ease: 'power2.inOut', transformOrigin: '50% 50%', overwrite: 'auto' });
        gsap.to(head.current, { ...headVars, duration: 0.4, ease: 'power2.out', transformOrigin: '50% 80%', overwrite: 'auto' });
      },
      cheer() {
        shyRef.current = false;
        const tl = gsap.timeline();
        tl.set(eyeShapes.current, { opacity: 0, scaleY: 1, y: 0 }).set(happyEyes.current, { opacity: 1 });
        // back to the normal face after a while (the screen usually moves on before)
        tl.set(happyEyes.current, { opacity: 0 }, 2.6).set(eyeShapes.current, { opacity: 1 }, 2.6);
        tl.to(tips.current?.children ?? [], { fill: '#fff4c2', duration: 0.15, yoyo: true, repeat: 3 }, 0);
        if (!reducedMotion()) {
          tl.to(head.current, { rotation: 0, duration: 0.2 }, 0)
            .to(body.current, { y: -7, duration: 0.25, ease: 'power2.out' }, 0)
            .to(body.current, { y: 0, duration: 0.5, ease: 'bounce.out' }, 0.25)
            .to([earL.current, earR.current], { rotation: (i: number) => (i ? 18 : -18), duration: 0.12, yoyo: true, repeat: 3, transformOrigin: '50% 100%' }, 0.05)
            .to(shadow.current, { scaleX: 0.7, duration: 0.25, yoyo: true, repeat: 1, transformOrigin: '50% 50%' }, 0);
        }
      },
      oops() {
        const tl = gsap.timeline();
        tl.to(eyeShapes.current?.querySelectorAll('rect') ?? [], { fill: EYE_ERROR, duration: 0.12 })
          .to(eyeShapes.current?.querySelectorAll('rect') ?? [], { fill: EYE, duration: 0.4 }, 0.7);
        if (!reducedMotion()) {
          tl.to(head.current, { keyframes: { rotation: [0, -7, 6, -4, 2, 0] }, duration: 0.6, ease: 'power1.out', transformOrigin: '50% 80%' }, 0);
        }
      },
      talk() {
        if (reducedMotion() || !mouth.current) return;
        gsap.fromTo(mouth.current, { scaleY: 1 }, { scaleY: 1.9, duration: 0.09, yoyo: true, repeat: 5, ease: 'sine.inOut', transformOrigin: '50% 0%' });
      },
    }),
    [],
  );

  return (
    <svg ref={svg} className={className} viewBox="0 0 64 64" role="img" aria-label={label} focusable="false">
      <ellipse ref={shadow} cx="32" cy="59.4" rx="18" ry="2.6" fill="#000" opacity=".12" />
      <g ref={body}>
        <ellipse cx="26.2" cy="57" rx="4.2" ry="2.2" fill="#2a78d6" />
        <ellipse cx="37.8" cy="57" rx="4.2" ry="2.2" fill="#2a78d6" />
        <rect x="22" y="46.5" width="20" height="10" rx="4.5" fill="#f3f6fb" stroke="#d3dceb" strokeWidth="1.2" />
        <rect x="27.5" y="48.6" width="9" height="6.2" rx="2.4" fill="#cde2fb" />
        <circle cx="32" cy="51.7" r="2.3" fill="#ffc247" stroke="#2a78d6" strokeWidth="1.1" />
        <g ref={head}>
          <g stroke="#c9d3e2" strokeWidth="1.8" strokeLinecap="round">
            <path d="M23.5 13.5 21 6.8M40.5 13.5 43 6.8" />
          </g>
          <g ref={glows}>
            <circle cx="20.6" cy="5.8" r="4" fill="#ffd97a" opacity=".45" />
            <circle cx="43.4" cy="5.8" r="4" fill="#ffd97a" opacity=".45" />
          </g>
          <g ref={tips}>
            <circle cx="20.6" cy="5.8" r="2.5" fill="#ffc247" />
            <circle cx="43.4" cy="5.8" r="2.5" fill="#ffc247" />
          </g>
          <rect x="21" y="12.4" width="5" height="2.6" rx="1" fill="#2a78d6" />
          <rect x="38" y="12.4" width="5" height="2.6" rx="1" fill="#2a78d6" />
          <rect ref={earL} x="4.6" y="25" width="4.4" height="12" rx="2" fill="#2a78d6" />
          <rect ref={earR} x="55" y="25" width="4.4" height="12" rx="2" fill="#2a78d6" />
          <rect x="7.5" y="14.5" width="49" height="34" rx="11" fill="#f3f6fb" stroke="#d3dceb" strokeWidth="1.4" />
          <rect x="11.5" y="18.5" width="41" height="26" rx="8" fill="#1b2a47" />
          <path d="M15.5 22.8q3-2.6 7.2-2.8" fill="none" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" opacity=".25" />
          <g ref={eyes}>
            <circle cx="24" cy="30" r="6.5" fill={EYE} opacity=".18" />
            <circle cx="40" cy="30" r="6.5" fill={EYE} opacity=".18" />
            <g ref={eyeShapes}>
              <rect x="21.6" y="25.6" width="4.8" height="8.8" rx="2.4" fill={EYE} />
              <rect x="37.6" y="25.6" width="4.8" height="8.8" rx="2.4" fill={EYE} />
              <circle cx="25" cy="27.4" r=".95" fill="#fff" />
              <circle cx="41" cy="27.4" r=".95" fill="#fff" />
            </g>
            <g ref={happyEyes} opacity="0" fill="none" stroke={EYE} strokeWidth="2.2" strokeLinecap="round">
              <path d="M20.8 31.2q3.2-4.6 6.4 0" />
              <path d="M36.8 31.2q3.2-4.6 6.4 0" />
            </g>
          </g>
          <ellipse cx="16.8" cy="35.6" rx="2.7" ry="1.6" fill="#f293b5" />
          <ellipse cx="47.2" cy="35.6" rx="2.7" ry="1.6" fill="#f293b5" />
          <path ref={mouth} d="M28.6 36.4h6.8a3.4 2 0 0 1-6.8 0z" fill={EYE} />
        </g>
      </g>
    </svg>
  );
});
