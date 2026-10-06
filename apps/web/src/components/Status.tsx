import gsap from 'gsap';
import { useEffect, useRef } from 'react';
import type { TaskStatus } from '@solar/shared';
import { STATUS_LABEL } from '../lib/format';
import { AlertIcon, BanIcon, CheckCircleIcon, ClockIcon, HandIcon, SpinnerIcon } from './Icons';

/** Status = icon + label + colour (never colour alone). */
export function StatusBadge({ status }: { status: TaskStatus }) {
  const icon = {
    queued: <ClockIcon />,
    running: <SpinnerIcon />,
    awaiting_confirmation: <HandIcon />,
    completed: <CheckCircleIcon />,
    failed: <AlertIcon />,
    cancelled: <BanIcon />,
  }[status];
  return (
    <span className="badge" data-status={status}>
      {icon}
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Progress meter: the fill carries the state, the track is a lighter step of the same hue. */
export function ProgressMeter({ value, status, label }: { value: number; status: TaskStatus; label?: string }) {
  const fillRef = useRef<HTMLSpanElement>(null);
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  useEffect(() => {
    if (!fillRef.current) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    gsap.to(fillRef.current, { width: `${pct}%`, duration: reduce ? 0 : 0.6, ease: 'power2.out' });
  }, [pct]);
  return (
    <div className="meter-row">
      <div className="meter" data-status={status} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label ?? 'Progres'}>
        <span ref={fillRef} style={{ width: 0 }} />
      </div>
      <b>{pct}%</b>
    </div>
  );
}
