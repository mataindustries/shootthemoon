import type { FirstStrikeSnapshot } from '../domain/firstStrike.ts'
import { getRivalIdentity } from '../content/rivalIdentity.ts'
import type { RivalSignalSnapshot } from '../domain/rival.ts'
import type { FirstStrikePresentationState } from './firstStrikePresentation.ts'

interface FirstStrikeHudProps {
  readonly strike: FirstStrikeSnapshot | null
  readonly rival: RivalSignalSnapshot | null
  readonly presentation: FirstStrikePresentationState
  readonly confirmationOpen: boolean
  readonly showReady: boolean
  readonly onArm: () => void
  readonly onOpenConfirmation: () => void
  readonly onCancel: () => void
  readonly onFire: () => void
  readonly onExploreScar: () => void
  readonly onPlayAgain: () => void
}

const STRIKE_CAPTIONS: Readonly<Record<string, string>> = Object.freeze({
  arming: 'LUNAR WARHEAD · ARMING SEQUENCE',
  launch: 'FIRST STRIKE · LAUNCH COMMITTED',
  'orbital-flight': 'BALLISTIC ARC · NULL MERIDIAN',
  'target-approach': 'TARGET FOOTHOLD · TERMINAL APPROACH',
  'impact-flash': 'IMPACT',
  ejecta: 'LUNAR EJECTA EXPANDING',
  'crater-reveal': 'NULL MERIDIAN SIGNAL LOST',
  'orbital-pullback': 'SURFACE CHANGE CONFIRMED',
})

export function FirstStrikeHud({
  strike,
  rival,
  presentation,
  confirmationOpen,
  showReady,
  onArm,
  onOpenConfirmation,
  onCancel,
  onFire,
  onExploreScar,
  onPlayAgain,
}: FirstStrikeHudProps) {
  if (strike === null || rival === null) {
    return null
  }

  const phase = presentation.phase
  const caption = STRIKE_CAPTIONS[phase]
  const identity = getRivalIdentity(rival.identityId)
  const ready = showReady && phase === 'idle' &&
    (strike.status === 'READY' || strike.status === 'ARMED')
  const completedIdle = phase === 'idle' && strike.status === 'COMPLETE'

  return (
    <div className="first-strike-hud" aria-live="polite">
      {ready ? (
        <section className="strike-ready" aria-label="First Strike protocol">
          <div className="strike-ready__eyebrow">
            <span aria-hidden="true" />
            FIRST STRIKE PROTOCOL AVAILABLE
          </div>
          <p>Strike ends this prototype run.</p>
          <button
            className="strike-arm-action"
            type="button"
            onClick={strike.status === 'READY' ? onArm : onOpenConfirmation}
          >
            <span>
              {strike.status === 'READY'
                ? 'ARM LUNAR WARHEAD'
                : 'WARHEAD ARMED · CONFIRM'}
            </span>
            <b>NULL MERIDIAN</b>
          </button>
        </section>
      ) : null}

      {confirmationOpen && strike.status === 'ARMED' ? (
        <div className="strike-confirmation-backdrop">
          <section
            className="strike-confirmation"
            role="dialog"
            aria-modal="true"
            aria-labelledby="strike-confirmation-title"
          >
            <span>FINAL COMMAND AUTHORITY</span>
            <h2 id="strike-confirmation-title">LAUNCH AT NULL MERIDIAN?</h2>
            <p>This action ends the current prototype run.</p>
            <div>
              <button type="button" onClick={onCancel}>CANCEL</button>
              <button className="strike-fire-action" type="button" onClick={onFire}>
                FIRE
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {caption !== undefined ? (
        <div className={`strike-caption strike-caption--${phase}`}>
          <span aria-hidden="true" />
          {caption}
        </div>
      ) : null}

      {phase === 'vesper-transmission' ? (
        <section className="strike-vesper-transmission">
          <div>
            <span>PRIORITY TRANSMISSION</span>
            <b>{identity.faction}</b>
          </div>
          <h2>{identity.commander}</h2>
          <p>{identity.finalStrikeTransmission}</p>
        </section>
      ) : null}

      {phase === 'impact-flash' ? (
        <div className="strike-whiteout" aria-hidden="true" />
      ) : null}

      {phase === 'ending' ? (
        <section className="strike-ending" aria-label="Prototype complete">
          <span>PROTOTYPE COMPLETE</span>
          <h1>FIRST STRIKE COMPLETE</h1>
          <p>THE MOON REMEMBERS.</p>
          <small>Null Meridian's foothold is gone. Its scar remains.</small>
          <div>
            <button type="button" onClick={onExploreScar}>
              EXPLORE THE SCAR
            </button>
            <button type="button" onClick={onPlayAgain}>
              PLAY AGAIN
            </button>
          </div>
        </section>
      ) : null}

      {completedIdle ? (
        <div className="strike-complete-status">
          <span>FIRST STRIKE COMPLETE</span>
          <b>PERMANENT SCAR · NULL MERIDIAN</b>
        </div>
      ) : null}
    </div>
  )
}
