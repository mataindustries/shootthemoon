import { findDeposit, type OutpostSnapshot } from '../domain/outpost.ts'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import {
  EXTRACTOR_COST,
  canConstructExtractor,
  canMineDeposit,
} from '../simulation/outpostSimulation.ts'
import type { ExperiencePhase } from '../simulation/moonCoreState.ts'
import type { CounterstrikeOutcome } from '../domain/counterstrike.ts'
import type { CounterstrikeRunStatus } from '../simulation/counterstrikeSimulation.ts'

interface CinematicHudProps {
  readonly phase: ExperiencePhase
  readonly site: LandingSite | null
  readonly outpost: OutpostSnapshot | null
  readonly selectedDepositId: string | null
  readonly targetingOutpost: boolean
  readonly rivalRevealed: boolean
  readonly rivalSignalHeld: boolean
  readonly lunarControlContested: boolean
  readonly firstStrikeAvailable: boolean
  readonly firstStrikeComplete: boolean
  readonly counterstrikeState: CounterstrikeRunStatus
  readonly counterstrikeOutcome: CounterstrikeOutcome | null
  readonly soundAvailable: boolean
  readonly soundEnabled: boolean
  readonly onClaim: () => void
  readonly onClear: () => void
  readonly onReturn: () => void
  readonly onDeploy: () => void
  readonly onMine: () => void
  readonly onConstruct: () => void
  readonly onResetPrototype: () => void
  readonly onToggleSound: () => void
}

function formatCoordinate(valueRad: number, positive: string, negative: string) {
  const degrees = Math.abs((valueRad * 180) / Math.PI)
  const direction = valueRad < 0 ? negative : positive
  return {
    value: degrees.toFixed(3) + '°',
    direction,
  }
}

function formatAltitude(heightM: number): string {
  const rounded = Math.round(heightM)
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

function phaseLabel(
  phase: ExperiencePhase,
  outpost: OutpostSnapshot | null,
  rivalRevealed: boolean,
  firstStrikeAvailable: boolean,
  firstStrikeComplete: boolean,
  counterstrikeState: CounterstrikeRunStatus,
  counterstrikeOutcome: CounterstrikeOutcome | null,
): string {
  if (counterstrikeState !== 'dormant') {
    if (counterstrikeState === 'resolved') {
      return counterstrikeOutcome === 'FAILURE'
        ? 'OUTPOST DAMAGED · REPAIRS REQUIRED'
        : 'OUTPOST SECURE · THREAT DEFEATED'
    }
    return counterstrikeState === 'warning'
      ? 'HOSTILE SIGNAL · ORBITAL APPROACH'
      : 'VESPER COUNTERSTRIKE · INTERCEPT ACTIVE'
  }

  if (firstStrikeComplete) {
    return 'SCARRED MOON · ORBITAL RECORD'
  }

  if (firstStrikeAvailable) {
    return 'LUNAR WARHEAD AVAILABLE'
  }

  if (phase === 'landed' && outpost !== null) {
    if (outpost.extractor?.status === 'constructing') {
      return 'EXTRACTOR ASSEMBLY'
    }

    return outpost.stage === 'extractor-active'
      ? 'EXTRACTION ONLINE'
      : 'FIRST OUTPOST'
  }

  switch (phase) {
    case 'orbit':
      return outpost === null
        ? 'ORBITAL RECONNAISSANCE'
        : rivalRevealed
          ? 'TWO FACTIONS · ONE MOON'
          : 'OUTPOST IN ORBITAL VIEW'
    case 'selected':
      return outpost === null ? 'LANDING VECTOR ACQUIRED' : 'OUTPOST SIGNAL LOCKED'
    case 'approach':
      return outpost === null ? 'INVASION CAPSULE INBOUND' : 'RETURNING TO OUTPOST'
    case 'landed':
      return 'FIRST OUTPOST'
    case 'returning':
      return 'RETURNING TO ORBIT'
  }
}

function robotStatus(outpost: OutpostSnapshot): string {
  switch (outpost.robot.state) {
    case 'stored':
      return 'MINER STORED'
    case 'deploying':
      return 'DEPLOYING MINER'
    case 'idle':
      return outpost.extractor?.status === 'active'
        ? 'MINER IDLE · EXTRACTOR RUNNING'
        : 'MINER READY'
    case 'traveling':
      return 'MINER EN ROUTE'
    case 'mining':
      return 'DRILLING LUNAR ORE'
    case 'returning':
      return `RETURNING · ${outpost.robot.carriedOre} ORE`
    case 'unloading':
      return `UNLOADING · ${outpost.robot.carriedOre} ORE`
  }
}

function ContextPrompt({
  outpost,
  selectedDepositId,
  rivalSignalHeld,
}: {
  readonly outpost: OutpostSnapshot
  readonly selectedDepositId: string | null
  readonly rivalSignalHeld: boolean
}) {
  let message: string | null = null

  if (rivalSignalHeld) {
    message = 'SIGNAL HELD · RETURN TO ORBIT'
  } else if (outpost.robot.state === 'stored') {
    message = 'OPEN THE CAPSULE'
  } else if (
    outpost.robot.state === 'idle' &&
    outpost.stage === 'miner-deployed' &&
    outpost.extractor === null &&
    selectedDepositId === null &&
    outpost.lunarOre < EXTRACTOR_COST
  ) {
    message = 'TAP AN ORE SIGNAL'
  }

  return message === null ? null : (
    <div className="context-prompt" role="status">
      <span aria-hidden="true" />
      {message}
    </div>
  )
}

export function CinematicHud({
  phase,
  site,
  outpost,
  selectedDepositId,
  targetingOutpost,
  rivalRevealed,
  rivalSignalHeld,
  lunarControlContested,
  firstStrikeAvailable,
  firstStrikeComplete,
  counterstrikeState,
  counterstrikeOutcome,
  soundAvailable,
  soundEnabled,
  onClaim,
  onClear,
  onReturn,
  onDeploy,
  onMine,
  onConstruct,
  onResetPrototype,
  onToggleSound,
}: CinematicHudProps) {
  const latitude =
    site === null
      ? null
      : formatCoordinate(site.location.latitudeRad, 'N', 'S')
  const longitude =
    site === null
      ? null
      : formatCoordinate(site.location.longitudeRad, 'E', 'W')
  const selectedDeposit =
    outpost === null ? null : findDeposit(outpost, selectedDepositId)
  const canConstruct =
    outpost !== null && selectedDeposit !== null
      ? canConstructExtractor(outpost, selectedDeposit.id)
      : false
  const canMine =
    outpost !== null && selectedDeposit !== null
      ? canMineDeposit(outpost, selectedDeposit.id)
      : false

  return (
    <div className="hud" aria-live="polite">
      <header className="hud-header">
        <div className="brand-lockup">
          <span className="brand-kicker">SHOOT THE MOON</span>
          <strong>
            {counterstrikeState !== 'dormant'
              ? 'ORBITAL INTERCEPT'
              : firstStrikeComplete
              ? 'SCARRED MOON'
              : firstStrikeAvailable
                ? 'FIRST STRIKE'
                : rivalRevealed
                  ? 'RIVAL SIGNAL'
                  : 'FIRST OUTPOST'}
          </strong>
        </div>
        <div className="hud-meta">
          <span className="phase-label">
            {phaseLabel(
              phase,
              outpost,
              rivalRevealed,
              firstStrikeAvailable,
              firstStrikeComplete,
              counterstrikeState,
              counterstrikeOutcome,
            )}
          </span>
          <div className="hud-utilities">
            <button
              className="sound-toggle"
              type="button"
              onClick={onToggleSound}
              disabled={!soundAvailable}
            >
              SOUND {soundAvailable ? (soundEnabled ? 'ON' : 'OFF') : '—'}
            </button>
            <button
              className="reset-button"
              type="button"
              onClick={onResetPrototype}
            >
              RESET PROTOTYPE
            </button>
          </div>
        </div>
      </header>

      {phase === 'landed' && outpost !== null ? (
        <>
          <section className="surface-status" aria-label="Outpost status">
            <div className="ore-counter">
              <span>LUNAR ORE</span>
              <strong>{outpost.lunarOre}</strong>
            </div>
            <div className="robot-status" data-robot-status={outpost.robot.state}>
              <span className="signal-dot" aria-hidden="true" />
              <span>{robotStatus(outpost)}</span>
            </div>
          </section>

          <ContextPrompt
            outpost={outpost}
            selectedDepositId={selectedDepositId}
            rivalSignalHeld={rivalSignalHeld}
          />

          <section className="command-deck" aria-label="Outpost commands">
            {selectedDeposit !== null ? (
              <div
                className="deposit-readout"
                data-deposit-id={selectedDeposit.id}
              >
                <div>
                  <span>SELECTED</span>
                  <strong>{selectedDeposit.resource}</strong>
                </div>
                <div>
                  <span>DISTANCE</span>
                  <strong>
                    {Math.round(
                      Math.hypot(
                        selectedDeposit.position.xM,
                        selectedDeposit.position.zM,
                      ),
                    )}{' '}
                    M
                  </strong>
                </div>
                <div>
                  <span>YIELD</span>
                  <strong>{selectedDeposit.remainingYield}</strong>
                </div>
              </div>
            ) : null}

            {outpost.robot.state === 'stored' ? (
              <button className="primary-action" type="button" onClick={onDeploy}>
                <span>DEPLOY MINER</span>
                <b aria-hidden="true">01</b>
              </button>
            ) : null}

            {canConstruct ? (
              <button
                className="primary-action primary-action--construct"
                type="button"
                onClick={onConstruct}
              >
                <span>CONSTRUCT EXTRACTOR</span>
                <b>{EXTRACTOR_COST} ORE</b>
              </button>
            ) : canMine ? (
              <button className="primary-action" type="button" onClick={onMine}>
                <span>MINE DEPOSIT</span>
                <b aria-hidden="true">COMMAND</b>
              </button>
            ) : null}

            <button className="orbit-return" type="button" onClick={onReturn}>
              RETURN TO ORBIT
            </button>
          </section>
        </>
      ) : site === null ? (
        <div className="orbit-instruction">
          {outpost === null ? (
            <>
              <span>DRAG TO ORBIT</span>
              <i aria-hidden="true" />
              <span>PINCH TO ZOOM</span>
              <i aria-hidden="true" />
              <span>TAP TO MARK</span>
            </>
          ) : (
            <>
              <span className="signal-dot" aria-hidden="true" />
              <span>{rivalRevealed ? 'AMBER · YOUR OUTPOST' : 'TAP AMBER SIGNAL TO REVISIT'}</span>
              {rivalRevealed ? (
                <>
                  <i aria-hidden="true" />
                  <span className="rival-signal-dot" aria-hidden="true" />
                  <span>CYAN · VESPER</span>
                </>
              ) : null}
              <b>{outpost.lunarOre} ORE</b>
              {lunarControlContested ? <em>CONTESTED</em> : null}
            </>
          )}
        </div>
      ) : (
        <section
          className={'site-panel site-panel--' + phase}
          data-latitude-rad={site.location.latitudeRad}
          data-longitude-rad={site.location.longitudeRad}
          aria-label={targetingOutpost ? 'Saved lunar outpost' : 'Selected lunar landing site'}
        >
          <div className="site-panel__eyebrow">
            <span className="signal-dot" aria-hidden="true" />
            {targetingOutpost ? 'ESTABLISHED OUTPOST' : 'CANDIDATE SITE'}
          </div>
          <div className="coordinate-grid">
            <div>
              <span>LATITUDE</span>
              <strong>{latitude?.value}</strong>
              <b>{latitude?.direction}</b>
            </div>
            <div>
              <span>LONGITUDE</span>
              <strong>{longitude?.value}</strong>
              <b>{longitude?.direction}</b>
            </div>
          </div>
          <div className="datum-line">
            MEAN SPHERE · ALT {formatAltitude(site.location.heightM)} M
          </div>

          {phase === 'selected' ? (
            <div className="site-actions">
              <button className="claim-button" type="button" onClick={onClaim}>
                <span>
                  {targetingOutpost ? 'REVISIT OUTPOST' : 'CLAIM LANDING SITE'}
                </span>
                <span aria-hidden="true">SITE 01</span>
              </button>
              <button className="text-button" type="button" onClick={onClear}>
                {targetingOutpost ? 'CANCEL' : 'CLEAR SITE'}
              </button>
            </div>
          ) : null}

          {phase === 'approach' ? (
            <button className="text-button" type="button" onClick={onReturn}>
              {outpost === null ? 'ABORT DESCENT' : 'RETURN TO ORBIT'}
            </button>
          ) : null}
        </section>
      )}
    </div>
  )
}
