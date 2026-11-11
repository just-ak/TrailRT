import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { hintPosition, type HintPlacement } from './hintPosition';

/**
 * A compact, icon-only button with a hint. Phase 10 Requirement 17.
 *
 * `hint` names the action. It is the button's accessible label, and it is
 * shown in a small bubble after a short hover, or at once when the button
 * gets keyboard focus. The bubble is drawn in a portal, so the scrolling
 * panels the buttons sit in can never clip it. An icon with no name is not
 * possible: `hint` is required.
 */

export const ICON_BUTTON_CLASS =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]';

const VARIANTS = {
  default: '',
  danger: 'hover:text-[var(--color-danger)]',
  active: 'border-[var(--color-accent)] text-[var(--color-accent)]',
  ghost: 'border-transparent bg-transparent',
} as const;

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title' | 'aria-label'> {
  hint: string;
  variant?: keyof typeof VARIANTS;
  children: ReactNode;
}

const HOVER_DELAY_MS = 300;

export function IconButton({ hint, variant = 'default', children, className = '', onClick, ...rest }: Props): ReactNode {
  const button = useRef<HTMLButtonElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [placement, setPlacement] = useState<HintPlacement | null>(null);

  const show = (): void => {
    const rect = button.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setPlacement(hintPosition(rect, hint, { width: window.innerWidth, height: window.innerHeight }));
  };
  const hide = (): void => {
    clearTimeout(timer.current);
    setPlacement(null);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={hint}
        className={`${ICON_BUTTON_CLASS} ${VARIANTS[variant]} ${className}`}
        onPointerEnter={() => {
          clearTimeout(timer.current);
          timer.current = setTimeout(show, HOVER_DELAY_MS);
        }}
        onPointerLeave={hide}
        onFocus={(event) => {
          // Keyboard focus shows the hint at once; a click's focus does not.
          if (event.currentTarget.matches(':focus-visible')) show();
        }}
        onBlur={hide}
        onClick={(event) => {
          hide();
          onClick?.(event);
        }}
        {...rest}
      >
        {children}
      </button>
      {placement !== null &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-[2000] max-w-[260px] -translate-x-1/2 rounded-md bg-[var(--color-text-primary)] px-2 py-1 text-[11px] leading-tight whitespace-nowrap text-[var(--color-surface)] shadow-lg"
            style={{
              left: placement.x,
              top: placement.side === 'below' ? placement.y : undefined,
              bottom: placement.side === 'above' ? window.innerHeight - placement.y : undefined,
            }}
          >
            {hint}
          </div>,
          document.body,
        )}
    </>
  );
}

/** An "i" in a circle: more information. */
export function InfoIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.01" />
    </svg>
  );
}
