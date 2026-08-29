import { getRivalIdentity } from '../content/rivalIdentity.ts'
import type { RivalSignalSnapshot } from '../domain/rival.ts'
import type { RivalPresentationState } from './rivalPresentation.ts'

interface RivalHudProps {
  readonly rival: RivalSignalSnapshot | null
  readonly presentation: RivalPresentationState
  readonly showControlStatus: boolean
  readonly onAdvance: () => void
  readonly onReturnToOrbit: () => void
  readonly onScan: () => void
  readonly onReplay: () => void
  readonly onSkip: () => void
  readonly firstStrikeAvailable: boolean
  readonly rivalDamaged: boolean
}

const CINEMATIC_CAPTIONS: Readonly<Record<string, string>> = Object.freeze({
  'orbital-transition': 'TRACING SIGNAL BEYOND LOCAL HORIZON',
  'capsule-approach': 'HOSTILE INSERTION VECTOR CONFIRMED',
  impact: 'FOREIGN LANDING CONFIRMED',
  'dual-sites': 'TWO CLAIMS DETECTED',
  'rival-focus': 'FOCUSING NULL MERIDIAN SIGNAL',
})

function Transmission({
  speaker,
  faction,
  body,
  action,
  onAdvance,
}: {
  readonly speaker: string
  readonly faction: string
  readonly body: string
  readonly action: string
  readonly onAdvance: () => void
}) {
  return (
    <section className="rival-transmission" aria-label={`${speaker} transmission`}>
      <div className="rival-transmission__source">
        <span>INCOMING TRANSMISSION</span>
        <b>{faction}</b>
      </div>
      <h2>{speaker}</h2>
      <p>{body}</p>
      <button type="button" onClick={onAdvance}>
        {action}
      </button>
    </section>
  )
}

function StrategicPanel({
  rival,
  scanning,
  onReturnToOrbit,
  onScan,
  onReplay,
}: {
  readonly rival: RivalSignalSnapshot
  readonly scanning: boolean
  readonly onReturnToOrbit: () => void
  readonly onScan: () => void
  readonly onReplay: () => void
}) {
  const identity = getRivalIdentity(rival.identityId)

  return (
    <section className="rival-strategic" aria-label="Rival site analysis">
      <div className="rival-strategic__eyebrow">
        <span aria-hidden="true" />
        NULL MERIDIAN SIGNAL
      </div>
      {rival.scanCompleted ? (
        <>
          <div className="rival-strategic__grid">
            <div>
              <span>CALLSIGN</span>
              <strong>{identity.callsign}</strong>
            </div>
            <div>
              <span>FOOTHOLD</span>
              <strong>{rival.stage}</strong>
            </div>
            <div>
              <span>SIGNAL</span>
              <strong>{identity.strategicLabels.signalStrength}</strong>
            </div>
            <div>
              <span>THREAT</span>
              <strong>{identity.strategicLabels.threatAssessment}</strong>
            </div>
          </div>
          <div className="rival-strategic__actions">
            <button type="button" onClick={onReturnToOrbit}>
              RETURN TO CONTESTED ORBIT
            </button>
            {rival.replayEligible ? (
              <button className="rival-text-action" type="button" onClick={onReplay}>
                REVIEW SIGNAL
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <p>
            {scanning
              ? 'RESOLVING SURFACE SIGNATURE'
              : 'IDENTITY AND CAPABILITY ENCRYPTED'}
          </p>
          {scanning ? (
            <div className="rival-scan-progress" role="status">
              <span />
            </div>
          ) : (
            <button className="rival-scan-action" type="button" onClick={onScan}>
              SCAN RIVAL SITE
            </button>
          )}
          {!scanning ? (
            <button className="rival-text-action" type="button" onClick={onReturnToOrbit}>
              RETURN TO ORBIT
            </button>
          ) : null}
        </>
      )}
    </section>
  )
}

export function RivalHud({
  rival,
  presentation,
  showControlStatus,
  onAdvance,
  onReturnToOrbit,
  onScan,
  onReplay,
  onSkip,
  firstStrikeAvailable,
  rivalDamaged,
}: RivalHudProps) {
  if (rival === null) {
    return null
  }

  const identity = getRivalIdentity(rival.identityId)
  const phase = presentation.phase
  const caption = CINEMATIC_CAPTIONS[phase]
  const maySkip = presentation.replay && rival.skipEligible
  const strategicObjective = rivalDamaged
    ? 'NULL MERIDIAN FOOTHOLD — DESTROYED'
    : firstStrikeAvailable
      ? 'FIRST STRIKE PROTOCOL AVAILABLE'
      : identity.strategicLabels.lockedObjective

  return (
    <div className="rival-hud" aria-live="polite">
      {phase === 'warning' ? (
        <section className="rival-warning" role="status">
          <span className="rival-warning__trace" aria-hidden="true" />
          <strong>UNIDENTIFIED LUNAR SIGNAL</strong>
          <small>EXTERNAL CARRIER · NONLOCAL ORIGIN</small>
        </section>
      ) : null}

      {caption !== undefined ? (
        <div className={`rival-cinematic-caption rival-cinematic-caption--${phase}`}>
          <span aria-hidden="true" />
          {caption}
        </div>
      ) : null}

      {phase === 'intro-transmission' ? (
        <Transmission
          speaker={identity.commander}
          faction={identity.faction}
          body={identity.introTransmission}
          action="HOLD THE CHANNEL"
          onAdvance={onAdvance}
        />
      ) : null}

      {phase === 'rival-focused' || phase === 'scanning' ? (
        <StrategicPanel
          rival={rival}
          scanning={phase === 'scanning'}
          onReturnToOrbit={onReturnToOrbit}
          onScan={onScan}
          onReplay={onReplay}
        />
      ) : null}

      {phase === 'scan-response' ? (
        <Transmission
          speaker={identity.commander}
          faction={identity.faction}
          body={identity.scanResponse}
          action="END TRANSMISSION"
          onAdvance={onAdvance}
        />
      ) : null}

      {phase === 'contested' ? (
        <section className="rival-contested" role="status">
          <span>{identity.strategicLabels.contestedStatus}</span>
          <strong>{identity.territorialThreat}</strong>
          <b>{strategicObjective}</b>
        </section>
      ) : null}

      {phase === 'idle' &&
      rival.scanResponseCompleted &&
      showControlStatus &&
      !rivalDamaged ? (
        <div className="rival-control-status">
          <span>{identity.strategicLabels.contestedStatus}</span>
          <b>{strategicObjective}</b>
        </div>
      ) : null}

      {maySkip && phase !== 'idle' ? (
        <button className="rival-skip" type="button" onClick={onSkip}>
          SKIP REVIEW
        </button>
      ) : null}
    </div>
  )
}
