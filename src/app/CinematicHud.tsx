import { OrbitalSiegeHud, type SiegeAction } from './OrbitalSiegeHud.tsx'
import { siegeIsActive } from '../domain/orbitalSiege.ts'
import { useState } from 'react'
import { useCoarsePointer } from './useCoarsePointer.ts'
import { depositLabel, outpostGuidance } from './outpostGuidance.ts'
import { formatMetric } from './hudFormatting.ts'
import {
  findDeposit,
  type OperatingMode,
  type OutpostModuleKind,
  type OutpostSnapshot,
} from '../domain/outpost.ts'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import {
  EXTRACTOR_COST,
  OUTPOST_MODULE_COST,
  canConstructModule,
  canConstructExtractor,
  canMineDeposit,
} from '../simulation/outpostSimulation.ts'
import type { ExperiencePhase } from '../simulation/moonCoreState.ts'
import type {
  CounterstrikeOrder,
  CounterstrikeOutcome,
} from '../domain/counterstrike.ts'
import type { OutpostDamageState } from '../domain/counterstrike.ts'
import type { CounterstrikeRunStatus } from '../simulation/counterstrikeSimulation.ts'
import {
  analyzeLandingSite,
  calculateOutpostOperations,
} from '../simulation/outpostOperations.ts'

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
  readonly damageState: OutpostDamageState
  readonly productionDamagePenalty: number
  readonly counterstrikeOrder: CounterstrikeOrder | null
  readonly soundAvailable: boolean
  readonly soundEnabled: boolean
  readonly onClaim: () => void
  readonly onClear: () => void
  readonly onReturn: () => void
  readonly onDeploy: () => void
  readonly onMine: () => void
  readonly onConstruct: () => void
  readonly onSetOperatingMode: (mode: OperatingMode) => void
  readonly onSiegeAction: (action: SiegeAction) => void
  readonly onConstructModule: (kind: OutpostModuleKind) => void
  readonly onResetPrototype: () => void
  readonly onToggleSound: () => void
}

const OPERATING_MODES: readonly OperatingMode[] = [
  'CONSERVE',
  'BALANCED',
  'OVERDRIVE',
]

function OperationsPanel({
  outpost,
  damageState,
  productionDamagePenalty,
  counterstrikeOrder,
  rivalSignalHeld,
  onSetOperatingMode,
  onConstructModule,
  onSiegeAction,
  onReturn,
  selectedDepositId,
  onMine,
}: {
  readonly outpost: OutpostSnapshot
  readonly damageState: OutpostDamageState
  readonly productionDamagePenalty: number
  readonly counterstrikeOrder: CounterstrikeOrder | null
  readonly rivalSignalHeld: boolean
  readonly onSetOperatingMode: (mode: OperatingMode) => void
  readonly onSiegeAction: (action: SiegeAction) => void
  readonly onConstructModule: (kind: OutpostModuleKind) => void
  readonly onReturn: () => void
  readonly selectedDepositId: string | null
  readonly onMine: () => void
}) {
  const [moduleSelectionOpen, setModuleSelectionOpen] = useState(false)
  const metrics = calculateOutpostOperations(
    outpost,
    damageState,
    counterstrikeOrder,
  )

  return (
    <section
      className="operations-panel"
      aria-label="Outpost operations"
      data-operation-status={metrics.status}
    >
      <div className="operations-panel__heading">
        <div>
          <span>OUTPOST OPERATIONS</span>
          <strong>{metrics.status}</strong>
        </div>
        <b>{Math.round(metrics.operatingEfficiency * 100)}% EFF</b>
      </div>
      <ContextPrompt
        outpost={outpost}
        selectedDepositId={selectedDepositId}
        rivalSignalHeld={rivalSignalHeld}
      />
      <p className="active-deposit">
        EXTRACTOR · {depositLabel(outpost.extractor!.depositId)} · AUTOMATIC MINING
      </p>
      {damageState === 'DAMAGED' ? (
        <p className="operations-damage" role="status">
          OUTPOST DAMAGED · −{Math.round(productionDamagePenalty * 100)}% PRODUCTION
        </p>
      ) : null}
      <div className="operations-metrics">
        <div>
          <span>ENERGY</span>
          <strong>{formatMetric(metrics.energyGeneratedKw)} KW</strong>
          <small>{formatMetric(metrics.energyConsumedKw)} USED</small>
        </div>
        <div>
          <span>ROBOTS</span>
          <strong>{metrics.activeRobots} / {metrics.availableRobots}</strong>
          <small>ACTIVE</small>
        </div>
        <div>
          <span>ORE RATE</span>
          <strong>{formatMetric(metrics.productionPerMin)}</strong>
          <small>ORE / MIN</small>
        </div>
        <div>
          <span>STORAGE</span>
          <strong>{formatMetric(metrics.storageUsed)} / {metrics.storageCapacity}</strong>
          <small>LUNAR ORE</small>
        </div>
      </div>
      <OrbitalSiegeHud outpost={outpost} metrics={metrics} onAction={onSiegeAction} />
      {!siegeIsActive(outpost.orbitalSiege) ? <details className="siege-outpost-controls" open={outpost.orbitalSiege === null ? true : undefined}>
      <summary>OUTPOST CONTROLS</summary>
      <div className="operations-controls" aria-label="Operating mode">
        {OPERATING_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={outpost.operations.mode === mode}
            onClick={() => onSetOperatingMode(mode)}
          >
            {mode}
          </button>
        ))}
      </div>
      {outpost.module === null && outpost.lunarOre >= OUTPOST_MODULE_COST ? (
        moduleSelectionOpen ? (
          <div className="module-selector" aria-label="Choose outpost module">
            <div className="module-selector__heading">
              <span>MODULE SLOT 01</span>
              <button type="button" onClick={() => setModuleSelectionOpen(false)}>
                CLOSE
              </button>
            </div>
            {([
              ['SOLAR_WING', 'SOLAR WING', '+25% ENERGY · EFFICIENT OVERDRIVE'],
              ['STORAGE_SILO', 'STORAGE SILO', '400 ORE CAPACITY'],
              ['REPAIR_GANTRY', 'REPAIR GANTRY', 'POWERED DAMAGE RECOVERY'],
            ] as const).map(([kind, label, detail]) => {
              const eligible = canConstructModule(outpost, kind, damageState)
              return (
                <button
                  key={kind}
                  type="button"
                  disabled={!eligible}
                  onClick={() => onConstructModule(kind)}
                >
                  <span><strong>{label}</strong><small>{detail}</small></span>
                  <b>{kind === 'REPAIR_GANTRY' && !eligible ? 'DAMAGE REQUIRED' : '20 ORE'}</b>
                </button>
              )
            })}
          </div>
        ) : (
          <button
            className="build-module-action"
            type="button"
            onClick={() => setModuleSelectionOpen(true)}
          >
            <span>BUILD MODULE</span>
            <b>1 SLOT · 20 ORE</b>
          </button>
        )
      ) : outpost.module !== null ? (
        <div className="module-status" data-module-status={outpost.module.status}>
          <span>
            {outpost.module.status === 'constructing'
              ? 'MODULE CONSTRUCTION'
              : 'OUTPOST TIER 2'}
          </span>
          <strong>{outpost.module.kind.replace('_', ' ')}</strong>
          {outpost.module.kind === 'REPAIR_GANTRY' &&
          outpost.module.status === 'active' &&
          outpost.module.repairProgress < 1 ? (
            <small>{Math.round(outpost.module.repairProgress * 100)}% RECOVERY · {formatMetric(metrics.repairConsumedKw)} KW</small>
          ) : null}
        </div>
      ) : null}
      </details> : null}
      {selectedDepositId !== null ? (
        <button
          className="operations-return"
          type="button"
          disabled={!canMineDeposit(outpost, selectedDepositId)}
          onClick={onMine}
          data-deposit-id={selectedDepositId}
        >
          {selectedDepositId.replace('deposit-', '').toUpperCase()} · {outpost.extractor?.depositId === selectedDepositId ? 'EXTRACTOR ACTIVE' : 'MINE DEPOSIT'}
        </button>
      ) : null}
      <button className="operations-return" type="button" onClick={onReturn}>
        RETURN TO ORBIT
      </button>
    </section>
  )
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

  if (firstStrikeComplete && phase !== 'landed') {
    return 'SCARRED MOON · ORBITAL RECORD'
  }

  if (firstStrikeAvailable && phase !== 'landed') {
    return 'LUNAR WARHEAD AVAILABLE'
  }

  if (phase === 'landed' && outpost !== null) {
    if (outpost.extractor?.status === 'constructing') {
      return 'EXTRACTOR ASSEMBLY'
    }
    if (outpost.module?.status === 'constructing') {
      return 'MODULE CONSTRUCTION'
    }
    if (outpost.module?.status === 'active') {
      return 'OUTPOST TIER 2'
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
      return 'LASER EXTRACTING ORE'
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
  const message = rivalSignalHeld
    ? 'SIGNAL HELD · RETURN TO ORBIT'
    : outpostGuidance(outpost, selectedDepositId)

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
  damageState,
  productionDamagePenalty,
  counterstrikeOrder,
  soundAvailable,
  soundEnabled,
  onClaim,
  onClear,
  onReturn,
  onDeploy,
  onMine,
  onConstruct,
  onSetOperatingMode,
  onConstructModule,
  onSiegeAction,
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
  const siteAnalysis = site === null ? null : analyzeLandingSite(site)
  const operationsActive = outpost?.extractor?.status === 'active'
  const coarsePointer = useCoarsePointer()

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
              <strong>{formatMetric(outpost.lunarOre)}</strong>
            </div>
            <div className="robot-status" data-robot-status={outpost.robot.state}>
              <span className="signal-dot" aria-hidden="true" />
              <span>
                {robotStatus(outpost)}
                {outpost.robot.targetDepositId !== null
                  ? ` · ${depositLabel(outpost.robot.targetDepositId)}`
                  : ''}
              </span>
            </div>
          </section>

          {operationsActive ? (
            <OperationsPanel
              outpost={outpost}
              damageState={damageState}
              productionDamagePenalty={productionDamagePenalty}
              counterstrikeOrder={counterstrikeOrder}
              rivalSignalHeld={rivalSignalHeld}
              onSetOperatingMode={onSetOperatingMode}
              onConstructModule={onConstructModule}
              onSiegeAction={onSiegeAction}
              onReturn={onReturn}
              selectedDepositId={selectedDepositId}
              onMine={onMine}
            />
          ) : (
          <section className="command-deck" aria-label="Outpost commands">
            <ContextPrompt
              outpost={outpost}
              selectedDepositId={selectedDepositId}
              rivalSignalHeld={rivalSignalHeld}
            />
            {selectedDeposit !== null ? (
              <div
                className="deposit-readout"
                data-deposit-id={selectedDeposit.id}
              >
                <div>
                  <span>SELECTED · {depositLabel(selectedDeposit.id)}</span>
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
          )}
        </>
      ) : site === null ? (
        <div className={"orbit-instruction" + (outpost === null ? " orbit-instruction--first-run" : "")}>
          {outpost === null ? (
            <>
              <strong className="first-run-objective">Select a site → claim → build → mine</strong>
              <span>DRAG TO ORBIT</span>
              <i aria-hidden="true" />
              <span>{coarsePointer ? 'PINCH TO ZOOM' : 'SCROLL TO ZOOM'}</span>
              <i aria-hidden="true" />
              <span>{coarsePointer ? 'TAP TO MARK' : 'CLICK TO MARK'}</span>
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
              <b>{formatMetric(outpost.lunarOre)} ORE</b>
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
            {phase === 'approach'
              ? outpost === null
                ? 'DESCENT'
                : 'RETURNING'
              : targetingOutpost
                ? 'ESTABLISHED OUTPOST'
                : 'SELECTED LANDING SITE'}
          </div>

          {phase !== 'approach' ? (
            <>
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

              {!targetingOutpost && siteAnalysis !== null ? (
                <div className="site-qualities" aria-label="Site qualities">
                  <div>
                    <span>SOLAR</span>
                    <strong>{siteAnalysis.solarQuality.toUpperCase()}</strong>
                  </div>
                  <div>
                    <span>EXTRACTION</span>
                    <strong>{siteAnalysis.extractionQuality.toUpperCase()}</strong>
                  </div>
                  <div>
                    <span>LOGISTICS</span>
                    <strong>{siteAnalysis.logisticsQuality.toUpperCase()}</strong>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

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
