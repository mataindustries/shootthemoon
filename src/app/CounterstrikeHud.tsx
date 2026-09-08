import { useEffect, useEffectEvent, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createOrderCountdown, ORDER_COUNTDOWN_MS } from './orderCountdown.ts'
import type {
  CounterstrikeOrder,
  CounterstrikeSnapshot,
} from '../domain/counterstrike.ts'
import type { RivalSignalSnapshot } from '../domain/rival.ts'
import { getRivalIdentity } from '../content/rivalIdentity.ts'
import {
  counterstrikeNeedsContinuousFrames,
  getCounterstrikeTimingProfile,
  type CounterstrikeRunState,
} from '../simulation/counterstrikeSimulation.ts'
import {
  INITIAL_INTERCEPTOR_FIRE_GESTURE,
  beginInterceptorFireGesture,
  cancelInterceptorFireGesture,
  endInterceptorFireGesture,
  moveInterceptorFireGesture,
  type InterceptorFireGestureState,
} from '../interaction/interceptorFireGate.ts'

interface CounterstrikeHudProps {
  readonly snapshot: CounterstrikeSnapshot | null
  readonly run: CounterstrikeRunState
  readonly rival: RivalSignalSnapshot | null
  readonly showReady: boolean
  readonly onBegin: () => void
  readonly onFire: () => void
  readonly onIssueOrder: (order: CounterstrikeOrder) => void
  readonly onReplay: () => void
  readonly onAcceptPreview: () => void
  readonly onKeepAccepted: () => void
  readonly onInspectOutpost: () => void
}

const COMMANDS: readonly {
  readonly order: CounterstrikeOrder
  readonly title: string
  readonly tradeoff: string
}[] = [
  {
    order: 'PRIORITIZE_INTERCEPTOR',
    title: 'PRIORITIZE INTERCEPTOR',
    tradeoff: 'Less mining · 40% wider fire window',
  },
  {
    order: 'HARDEN_OUTPOST',
    title: 'HARDEN OUTPOST',
    tradeoff: 'Less mining · Half damage if hit',
  },
  {
    order: 'KEEP_EXTRACTING',
    title: 'KEEP EXTRACTING',
    tradeoff: '25% more ore · Full damage if hit',
  },
]

function commandLabel(order: CounterstrikeOrder | null): string {
  return (
    COMMANDS.find((command) => command.order === order)?.title ??
    'NO ORDER'
  )
}

function commandOutcome(
  order: CounterstrikeOrder | null,
  success: boolean,
): string {
  if (order === 'PRIORITIZE_INTERCEPTOR') {
    return success
      ? 'Interceptor priority widened the fire window by 40%.'
      : 'The wider window was lost; production now operates at −30%.'
  }
  if (order === 'HARDEN_OUTPOST') {
    return success
      ? 'Outpost lockdown held while the standard firing solution succeeded.'
      : 'Bracing absorbed the strike; persistent production loss is only 15%.'
  }
  return success
    ? 'Full extraction continued through the standard firing solution.'
    : 'Boosted extraction banked ore, but production now operates at −30%.'
}

function CommandPanel({ onIssueOrder }: {
  readonly onIssueOrder: (order: CounterstrikeOrder) => void
}) {
  const [remainingMs, setRemainingMs] = useState(ORDER_COUNTDOWN_MS)
  const issuedRef = useRef(false)
  const expire = useEffectEvent(() => {
    if (issuedRef.current) return
    issuedRef.current = true
    onIssueOrder('HARDEN_OUTPOST')
  })

  useEffect(() => {
    const countdown = createOrderCountdown(performance.now(), document.hidden)
    const tick = () => {
      const remaining = countdown.sample(performance.now(), document.hidden)
      setRemainingMs(remaining)
      if (remaining === 0 && !document.hidden) expire()
    }
    const interval = window.setInterval(tick, 50)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])

  return (
    <section className="counterstrike-command" aria-label="Issue one Counterstrike order">
      <header>
        <span>RIVAL LAUNCH DETECTED</span>
        <strong>ISSUE ONE ORDER</strong>
      </header>
      <div className="counterstrike-command__countdown" role="timer" aria-live="off"
        aria-label={`${Math.ceil(remainingMs / 1000)} seconds until Harden Outpost`}>
        <strong>{Math.ceil(remainingMs / 1000)}s</strong>
        <span>THEN AUTO: HARDEN OUTPOST</span>
        <progress max={ORDER_COUNTDOWN_MS} value={remainingMs} aria-hidden="true" />
      </div>
      <div className="counterstrike-command__choices">
        {COMMANDS.map((command, index) => (
          <button key={command.order} type="button" data-command-order={command.order}
            onClick={() => {
              if (issuedRef.current) return
              issuedRef.current = true
              onIssueOrder(command.order)
            }}>
            <span className="counterstrike-command__number">{index + 1}</span>
            <span className="counterstrike-command__copy">
              <strong>{command.title}</strong>
              <small>{command.tradeoff}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

function pointerSample(event: ReactPointerEvent<HTMLButtonElement>) {
  return {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    isPrimary: event.isPrimary,
  }
}

function FireInterceptorButton({
  onFire,
  ready,
  finalAttempt,
}: {
  readonly onFire: () => void
  readonly ready: boolean
  readonly finalAttempt: boolean
}) {
  const gestureRef = useRef<InterceptorFireGestureState>(
    INITIAL_INTERCEPTOR_FIRE_GESTURE,
  )
  const pointerFireRef = useRef(false)

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    gestureRef.current = beginInterceptorFireGesture(
      gestureRef.current,
      pointerSample(event),
    )
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is optional; the pure gate still rejects interruptions.
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    gestureRef.current = moveInterceptorFireGesture(
      gestureRef.current,
      pointerSample(event),
    )
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const result = endInterceptorFireGesture(
      gestureRef.current,
      pointerSample(event),
    )
    gestureRef.current = result.state
    pointerFireRef.current = result.shouldFire
    if (result.shouldFire) onFire()
  }

  return (
    <button
      className={`counterstrike-fire ${
        ready ? 'is-fire-now' : 'is-tracking'
      }${finalAttempt ? ' is-final-attempt' : ''}`}
      type="button"
      aria-label={`${ready ? 'FIRE NOW' : 'TOO EARLY'} — FIRE INTERCEPTOR`}
      data-fire-gate="primary-tap"
      data-fire-cue={ready ? 'FIRE_NOW' : 'TOO_EARLY'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        gestureRef.current = cancelInterceptorFireGesture()
      }}
      onClick={(event) => {
        if (pointerFireRef.current) {
          pointerFireRef.current = false
          return
        }
        if (event.detail === 0) onFire()
      }}
    >
      <span className="counterstrike-fire__signal">
        {ready ? 'FIRE NOW' : 'TRACKING'}
      </span>
      <span className="counterstrike-fire__action">FIRE INTERCEPTOR</span>
      <b>
        {ready
          ? finalAttempt
            ? 'FINAL WINDOW · TAP ONCE'
            : 'INTERCEPT WINDOW · TAP ONCE'
          : 'TOO EARLY · HOLD FIRE'}
      </b>
    </button>
  )
}

export function CounterstrikeHud({
  snapshot,
  run,
  rival,
  showReady,
  onBegin,
  onFire,
  onIssueOrder,
  onReplay,
  onAcceptPreview,
  onKeepAccepted,
  onInspectOutpost,
}: CounterstrikeHudProps) {
  if (snapshot === null || rival === null) {
    return null
  }

  if (run.status === 'dormant') {
    return snapshot.available &&
      snapshot.acceptedOutcome === null &&
      showReady ? (
      <section className="counterstrike-ready" aria-label="Counterstrike available">
        <span>NULL MERIDIAN SIGNAL RECOVERED</span>
        <strong>COUNTERSTRIKE AVAILABLE</strong>
        <button type="button" onClick={onBegin}>
          TRACK COUNTERSTRIKE
        </button>
      </section>
    ) : null
  }

  const identity = getRivalIdentity(rival.identityId)
  const interactive =
    run.status === 'tracking' || run.status === 'intercept-ready'
  const resultPreview = run.status === 'resolved' && run.replay
  const success = run.outcome === 'SUCCESS'
  const resolved = run.status === 'resolved'
  const attemptsRemaining = 2 - run.attemptsUsed
  const active = counterstrikeNeedsContinuousFrames(run.status)
  const fireNow = run.status === 'intercept-ready'
  const finalAttempt = run.attemptNumber === 2
  return (
    <div
      className={`counterstrike-hud counterstrike-hud--${run.status}`}
      aria-live="assertive"
      data-counterstrike-active={active}
    >
      {run.status === 'command' ? (
        <CommandPanel onIssueOrder={onIssueOrder} />
      ) : null}

      {run.status === 'command-confirmed' ? (
        <section className="counterstrike-command-confirmed" role="status">
          <span>ORDER ISSUED</span>
          <strong>{commandLabel(run.order)}</strong>
          <small>OUTPOST ALLOCATION LOCKED</small>
        </section>
      ) : null}

      {run.status === 'warning' ? (
        <section className="counterstrike-warning" role="alert">
          <span aria-hidden="true" />
          <strong>RIVAL LAUNCH DETECTED</strong>
          <small>{commandLabel(run.order)} · ALLOCATION ACTIVE</small>
        </section>
      ) : null}

      {run.status === 'tracking' || run.status === 'intercept-ready' ? (
        <section
          className={`counterstrike-targeting ${
            fireNow ? 'is-fire-now' : 'is-tracking'
          }${finalAttempt ? ' is-final-attempt' : ''}`}
          aria-label="Orbital interception controls"
          data-intercept-cue={fireNow ? 'FIRE_NOW' : 'TRACKING'}
        >
          <div className="counterstrike-targeting__status">
            <strong>{fireNow ? 'FIRE NOW' : 'TRACKING'}</strong>
            <b>
              ATTEMPT {run.attemptNumber} / 2
              {run.order === 'PRIORITIZE_INTERCEPTOR' ? ' · WIDE WINDOW' : ''}
            </b>
          </div>
          <div
            className={`counterstrike-lock-meter${
              run.status === 'intercept-ready' ? ' is-ready' : ''
            }`}
            aria-hidden="true"
          >
            <span
              style={{
                animationDuration: `${getCounterstrikeTimingProfile(run.order).trackingMs}ms`,
              }}
            />
          </div>
          <p>
            {fireNow
              ? finalAttempt
                ? 'FINAL ATTEMPT · TAP WHILE THE AMBER RINGS ALIGN'
                : 'TAP ONCE WHILE THE AMBER RINGS ALIGN'
              : finalAttempt
                ? 'SECOND VECTOR ACQUIRED · HOLD FOR AMBER'
                : 'HOLD FIRE · TARGET ENTERING THE INTERCEPT ZONE'}
          </p>
          {interactive ? (
            <FireInterceptorButton
              onFire={onFire}
              ready={fireNow}
              finalAttempt={finalAttempt}
            />
          ) : null}
        </section>
      ) : null}

      {run.status === 'interceptor-launched' ? (
        <div className="counterstrike-caption">
          <span aria-hidden="true" />
          {run.judgement === 'VALID'
            ? `INTERCEPTOR COMMITTED · ATTEMPT ${run.attemptNumber}`
            : `${run.judgement === 'EARLY' ? 'TOO EARLY' : 'TOO LATE'} · INTERCEPTOR OFF VECTOR`}
        </div>
      ) : null}

      {run.status === 'missed' ? (
        <section className="counterstrike-missed" role="status">
          <strong>
            {run.judgement === 'EARLY' ? 'TOO EARLY' : 'TOO LATE'}
          </strong>
          <span>
            {attemptsRemaining > 0
              ? 'NEAR MISS · SECOND FIRE WINDOW INBOUND'
              : 'HOSTILE TERMINAL APPROACH'}
          </span>
        </section>
      ) : null}

      {run.status === 'success' ? (
        <section className="counterstrike-breakup" role="status">
          <span>ORBITAL BREAKUP CONFIRMED</span>
          <strong>INTERCEPTED</strong>
        </section>
      ) : null}

      {run.status === 'impact' ? (
        <section className="counterstrike-impact" role="status">
          <span>SECONDARY IMPACT · PLAYER SITE</span>
          <strong>OUTPOST TELEMETRY DEGRADED</strong>
        </section>
      ) : null}

      {resolved ? (
        <section
          className={`counterstrike-ending counterstrike-ending--${
            success ? 'success' : 'failure'
          }`}
          aria-label="Counterstrike outcome"
        >
          <span>{success ? 'ORBITAL THREAT NEUTRALIZED' : 'STRUCTURAL DAMAGE CONFIRMED'}</span>
          <h1>{success ? 'COUNTERSTRIKE DEFEATED' : 'COUNTERSTRIKE SURVIVED'}</h1>
          <h2>{success ? 'OUTPOST SECURE' : 'OUTPOST DAMAGED'}</h2>
          {!success ? <b>REPAIRS REQUIRED</b> : null}
          <p className="counterstrike-ending__order-effect">
            <b>{commandLabel(run.order)}</b>
            <span>{commandOutcome(run.order, success)}</span>
          </p>
          <blockquote>
            “{success
              ? identity.counterstrikeDefeatedTransmission
              : identity.counterstrikeDamageTransmission}”
            <cite>{identity.commander}</cite>
          </blockquote>
          {resultPreview ? (
            <div className="counterstrike-ending__decision">
              <small>REPLAY PREVIEW · ACCEPT THIS ENDING?</small>
              <button type="button" onClick={onAcceptPreview}>
                ACCEPT NEW OUTCOME
              </button>
              <button type="button" onClick={onKeepAccepted}>
                KEEP CURRENT ENDING
              </button>
            </div>
          ) : (
            <div className="counterstrike-ending__actions">
              <button
                type="button"
                onClick={onInspectOutpost}
                disabled={snapshot.acceptedOutcome === null}
              >
                VIEW OUTPOST OPERATIONS
              </button>
              <button
                className="counterstrike-replay"
                type="button"
                onClick={onReplay}
                disabled={!snapshot.replayEligible}
              >
                REPLAY COUNTERSTRIKE
              </button>
            </div>
          )}
        </section>
      ) : null}
    </div>
  )
}
