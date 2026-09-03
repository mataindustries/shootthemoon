import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { CounterstrikeSnapshot } from '../domain/counterstrike.ts'
import type { RivalSignalSnapshot } from '../domain/rival.ts'
import { getRivalIdentity } from '../content/rivalIdentity.ts'
import {
  counterstrikeNeedsContinuousFrames,
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
  readonly onReplay: () => void
  readonly onAcceptPreview: () => void
  readonly onKeepAccepted: () => void
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
  onReplay,
  onAcceptPreview,
  onKeepAccepted,
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
      {run.status === 'warning' ? (
        <section className="counterstrike-warning" role="alert">
          <span aria-hidden="true" />
          <strong>COUNTERSTRIKE DETECTED</strong>
          <small>NULL MERIDIAN · ORBITAL THREAT</small>
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
            <b>ATTEMPT {run.attemptNumber} / 2</b>
          </div>
          <div
            className={`counterstrike-lock-meter${
              run.status === 'intercept-ready' ? ' is-ready' : ''
            }`}
            aria-hidden="true"
          >
            <span />
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
            <button
              className="counterstrike-replay"
              type="button"
              onClick={onReplay}
              disabled={!snapshot.replayEligible}
            >
              REPLAY COUNTERSTRIKE
            </button>
          )}
        </section>
      ) : null}
    </div>
  )
}
