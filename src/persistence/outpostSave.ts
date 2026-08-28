import {
  DEPOSIT_BLUEPRINTS,
  EXTRACTOR_ID,
  MINER_ID,
  OUTPOST_ID,
  RESOURCE_NAME,
  type Extractor,
  type MineralDeposit,
  type OutpostSnapshot,
  type OutpostStage,
  type RobotState,
} from '../domain/outpost.ts'
import {
  MEAN_LUNAR_DATUM,
  createLandingSite,
  createLunarLocation,
  normalizeLongitude,
  type LandingSite,
  type QuaternionData,
} from '../domain/lunarCoordinates.ts'
import {
  RIVAL_IDENTITY_ID,
  RIVAL_SIGNAL_ID,
  deriveRivalSite,
  type RivalRevealStatus,
  type RivalSignalSnapshot,
  type RivalStage,
} from '../domain/rival.ts'
import {
  createMigratedRivalSignal,
  normalizeRivalSignalForResume,
} from '../simulation/rivalSimulation.ts'

export const OUTPOST_SAVE_SCHEMA_VERSION = 2
export const OUTPOST_STORAGE_KEY = 'shoot-the-moon:first-outpost:v1'

const PRE_RIVAL_SAVE_SCHEMA_VERSION = 1
const VALUE_EPSILON = 1e-9

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface PrototypeSnapshot {
  readonly outpost: OutpostSnapshot
  readonly rival: RivalSignalSnapshot
}

interface CanonicalLandingSave {
  readonly datumId: string
  readonly latitudeRad: number
  readonly longitudeRad: number
  readonly altitudeM: number
  readonly orientationMcmf: QuaternionData
}

interface RivalSaveData extends Omit<RivalSignalSnapshot, 'site'> {
  readonly canonicalLanding: CanonicalLandingSave
}

interface PrototypeSaveEnvelopeV2 {
  readonly schemaVersion: typeof OUTPOST_SAVE_SCHEMA_VERSION
  readonly savedAtMs: number
  readonly canonicalLanding: CanonicalLandingSave
  readonly outpost: Omit<OutpostSnapshot, 'site'>
  readonly rival: RivalSaveData
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0
}

function isNullableTimestamp(value: unknown): value is number | null {
  return value === null || isNonNegativeNumber(value)
}

function isRobotState(value: unknown): value is RobotState {
  return (
    value === 'stored' ||
    value === 'deploying' ||
    value === 'idle' ||
    value === 'traveling' ||
    value === 'mining' ||
    value === 'returning' ||
    value === 'unloading'
  )
}

function isOutpostStage(value: unknown): value is OutpostStage {
  return (
    value === 'capsule-landed' ||
    value === 'miner-deployed' ||
    value === 'extractor-active'
  )
}

function isRivalRevealStatus(value: unknown): value is RivalRevealStatus {
  return (
    value === 'DORMANT' ||
    value === 'AWAITING_SAFE_MOMENT' ||
    value === 'QUEUED' ||
    value === 'CINEMATIC' ||
    value === 'REVEALED'
  )
}

function isRivalStage(value: unknown): value is RivalStage {
  return (
    value === 'LANDED' ||
    value === 'ESTABLISHING' ||
    value === 'FORTIFIED'
  )
}

function parseOrientation(value: unknown): QuaternionData | null {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y) ||
    !isFiniteNumber(value.z) ||
    !isFiniteNumber(value.w)
  ) {
    return null
  }

  const length = Math.hypot(value.x, value.y, value.z, value.w)

  if (Math.abs(length - 1) > 1e-6) {
    return null
  }

  return { x: value.x, y: value.y, z: value.z, w: value.w }
}

function parseLandingSite(value: unknown): LandingSite | null {
  if (
    !isRecord(value) ||
    value.datumId !== MEAN_LUNAR_DATUM.id ||
    !isFiniteNumber(value.latitudeRad) ||
    !isFiniteNumber(value.longitudeRad) ||
    !isFiniteNumber(value.altitudeM)
  ) {
    return null
  }

  const orientation = parseOrientation(value.orientationMcmf)

  if (orientation === null) {
    return null
  }

  try {
    const derived = createLandingSite(
      createLunarLocation(
        value.latitudeRad,
        value.longitudeRad,
        value.altitudeM,
      ),
    )
    const orientationDifference = Math.hypot(
      derived.orientationMcmf.x - orientation.x,
      derived.orientationMcmf.y - orientation.y,
      derived.orientationMcmf.z - orientation.z,
      derived.orientationMcmf.w - orientation.w,
    )
    const negatedOrientationDifference = Math.hypot(
      derived.orientationMcmf.x + orientation.x,
      derived.orientationMcmf.y + orientation.y,
      derived.orientationMcmf.z + orientation.z,
      derived.orientationMcmf.w + orientation.w,
    )

    return Math.min(orientationDifference, negatedOrientationDifference) <= 1e-6
      ? derived
      : null
  } catch {
    return null
  }
}

function toCanonicalLanding(site: LandingSite): CanonicalLandingSave {
  return {
    datumId: site.datumId,
    latitudeRad: site.location.latitudeRad,
    longitudeRad: site.location.longitudeRad,
    altitudeM: site.location.heightM,
    orientationMcmf: site.orientationMcmf,
  }
}

function parseDeposit(value: unknown): MineralDeposit | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.resource !== RESOURCE_NAME ||
    !isRecord(value.position) ||
    !isFiniteNumber(value.position.xM) ||
    !isFiniteNumber(value.position.zM) ||
    !isFiniteNumber(value.orientationRad) ||
    !isNonNegativeNumber(value.initialYield) ||
    !isNonNegativeNumber(value.remainingYield) ||
    value.remainingYield > value.initialYield
  ) {
    return null
  }

  const blueprint = DEPOSIT_BLUEPRINTS.find(
    (candidate) => candidate.id === value.id,
  )

  if (
    blueprint === undefined ||
    value.position.xM !== blueprint.position.xM ||
    value.position.zM !== blueprint.position.zM ||
    value.orientationRad !== blueprint.orientationRad ||
    value.initialYield !== blueprint.initialYield
  ) {
    return null
  }

  return {
    id: value.id,
    resource: RESOURCE_NAME,
    position: blueprint.position,
    orientationRad: blueprint.orientationRad,
    initialYield: blueprint.initialYield,
    remainingYield: value.remainingYield,
  }
}

function parseExtractor(value: unknown): Extractor | null | undefined {
  if (value === null) {
    return null
  }

  if (
    !isRecord(value) ||
    value.id !== EXTRACTOR_ID ||
    typeof value.depositId !== 'string' ||
    !isRecord(value.position) ||
    !isFiniteNumber(value.position.xM) ||
    !isFiniteNumber(value.position.zM) ||
    !isFiniteNumber(value.orientationRad) ||
    (value.status !== 'constructing' && value.status !== 'active') ||
    !isNonNegativeNumber(value.constructionStartedAtMs) ||
    !isNonNegativeNumber(value.activationTimestampMs) ||
    !isNonNegativeNumber(value.lastProductionAtMs)
  ) {
    return undefined
  }

  const blueprint = DEPOSIT_BLUEPRINTS.find(
    (candidate) => candidate.id === value.depositId,
  )

  if (
    blueprint === undefined ||
    value.position.xM !== blueprint.position.xM ||
    value.position.zM !== blueprint.position.zM ||
    value.orientationRad !== blueprint.orientationRad
  ) {
    return undefined
  }

  return {
    id: EXTRACTOR_ID,
    depositId: value.depositId,
    position: blueprint.position,
    orientationRad: blueprint.orientationRad,
    status: value.status,
    constructionStartedAtMs: value.constructionStartedAtMs,
    activationTimestampMs: value.activationTimestampMs,
    lastProductionAtMs: value.lastProductionAtMs,
  }
}

function normalizeOutpostForResume(
  outpost: OutpostSnapshot,
  nowMs: number,
): OutpostSnapshot {
  const robotWasCarrying =
    outpost.robot.state === 'returning' ||
    outpost.robot.state === 'unloading'
  const robotIsTransient =
    outpost.robot.state !== 'stored' && outpost.robot.state !== 'idle'
  const robot = robotIsTransient
    ? {
        ...outpost.robot,
        state: 'idle' as const,
        stateStartedAtMs: nowMs,
        targetDepositId: null,
        carriedOre: 0,
      }
    : {
        ...outpost.robot,
        stateStartedAtMs: nowMs,
        targetDepositId:
          outpost.robot.state === 'idle' ? null : outpost.robot.targetDepositId,
        carriedOre: outpost.robot.state === 'idle' ? 0 : outpost.robot.carriedOre,
      }
  const extractor =
    outpost.extractor === null
      ? null
      : {
          ...outpost.extractor,
          status: 'active' as const,
          lastProductionAtMs: nowMs,
        }
  let stage = outpost.stage

  if (robotIsTransient && stage === 'capsule-landed') {
    stage = 'miner-deployed'
  }

  if (extractor !== null) {
    stage = 'extractor-active'
  }

  return {
    ...outpost,
    stage,
    updatedAtMs: nowMs,
    lunarOre:
      outpost.lunarOre +
      (robotWasCarrying ? outpost.robot.carriedOre : 0),
    robot,
    extractor,
  }
}

function parseOutpost(
  canonicalLanding: unknown,
  value: unknown,
  nowMs: number,
): OutpostSnapshot | null {
  const site = parseLandingSite(canonicalLanding)

  if (
    site === null ||
    !isRecord(value) ||
    value.id !== OUTPOST_ID ||
    !isOutpostStage(value.stage) ||
    !isNonNegativeNumber(value.establishedAtMs) ||
    !isNonNegativeNumber(value.updatedAtMs) ||
    !isNonNegativeNumber(value.lunarOre) ||
    !isRecord(value.robot) ||
    value.robot.id !== MINER_ID ||
    !isRobotState(value.robot.state) ||
    !isNonNegativeNumber(value.robot.stateStartedAtMs) ||
    (value.robot.targetDepositId !== null &&
      typeof value.robot.targetDepositId !== 'string') ||
    !isNonNegativeNumber(value.robot.carriedOre) ||
    !Array.isArray(value.deposits) ||
    value.deposits.length !== DEPOSIT_BLUEPRINTS.length
  ) {
    return null
  }

  const deposits = value.deposits.map(parseDeposit)

  if (
    deposits.some((deposit) => deposit === null) ||
    new Set(deposits.map((deposit) => deposit?.id)).size !==
      DEPOSIT_BLUEPRINTS.length
  ) {
    return null
  }

  const extractor = parseExtractor(value.extractor)

  if (extractor === undefined) {
    return null
  }

  const parsed: OutpostSnapshot = {
    id: OUTPOST_ID,
    site,
    stage: value.stage,
    establishedAtMs: value.establishedAtMs,
    updatedAtMs: value.updatedAtMs,
    lunarOre: value.lunarOre,
    robot: {
      id: MINER_ID,
      state: value.robot.state,
      stateStartedAtMs: value.robot.stateStartedAtMs,
      targetDepositId: value.robot.targetDepositId,
      carriedOre: value.robot.carriedOre,
    },
    deposits: deposits as readonly MineralDeposit[],
    extractor,
  }

  return normalizeOutpostForResume(parsed, nowMs)
}

function sameCanonicalRivalSite(
  playerSite: LandingSite,
  rivalSite: LandingSite,
  surfaceHeadingRad: number,
): boolean {
  const expected = deriveRivalSite(playerSite)
  const longitudeDifference = Math.abs(
    normalizeLongitude(
      expected.site.location.longitudeRad - rivalSite.location.longitudeRad,
    ),
  )
  const headingDifference = Math.abs(
    normalizeLongitude(expected.surfaceHeadingRad - surfaceHeadingRad),
  )

  return (
    expected.site.datumId === rivalSite.datumId &&
    Math.abs(
      expected.site.location.latitudeRad - rivalSite.location.latitudeRad,
    ) <= VALUE_EPSILON &&
    longitudeDifference <= VALUE_EPSILON &&
    Math.abs(expected.site.location.heightM - rivalSite.location.heightM) <=
      VALUE_EPSILON &&
    headingDifference <= VALUE_EPSILON
  )
}

function completionMatchesTimestamp(
  completed: boolean,
  timestamp: number | null,
): boolean {
  return completed ? timestamp !== null : timestamp === null
}

function timestampsDoNotExceedUpdatedAt(
  rival: RivalSignalSnapshot,
): boolean {
  const timestamps = [
    rival.revealTriggeredAtMs,
    rival.stageChangedAtMs,
    rival.introTransmissionCompletedAtMs,
    rival.cinematicCompletedAtMs,
    rival.scanCompletedAtMs,
    rival.scanResponseCompletedAtMs,
  ]

  return timestamps.every(
    (timestamp) => timestamp === null || timestamp <= rival.updatedAtMs,
  )
}

function rivalStateIsConsistent(rival: RivalSignalSnapshot): boolean {
  const isDormant = rival.revealStatus === 'DORMANT'
  const isRevealed = rival.revealStatus === 'REVEALED'
  const cinematicFlagsMatch =
    completionMatchesTimestamp(
      rival.cinematicCompleted,
      rival.cinematicCompletedAtMs,
    ) &&
    (rival.cinematicCompleted
      ? rival.cinematicViewedOnce &&
        rival.replayEligible &&
        rival.skipEligible
      : !rival.cinematicViewedOnce &&
        !rival.replayEligible &&
        !rival.skipEligible)
  const scanFlagsMatch =
    completionMatchesTimestamp(rival.scanCompleted, rival.scanCompletedAtMs) &&
    completionMatchesTimestamp(
      rival.scanResponseCompleted,
      rival.scanResponseCompletedAtMs,
    ) &&
    (!rival.scanResponseCompleted || rival.scanCompleted)
  const stageMatches =
    (rival.stage === null && rival.stageChangedAtMs === null) ||
    (rival.stage !== null && rival.stageChangedAtMs !== null)
  const progressionMatches =
    (rival.stage === null && !rival.cinematicCompleted) ||
    (rival.stage === 'LANDED' &&
      rival.cinematicCompleted &&
      !rival.scanCompleted) ||
    ((rival.stage === 'ESTABLISHING' || rival.stage === 'FORTIFIED') &&
      rival.cinematicCompleted &&
      rival.scanCompleted)

  return (
    rival.updatedAtMs >= rival.createdAtMs &&
    timestampsDoNotExceedUpdatedAt(rival) &&
    (isDormant
      ? rival.revealTriggeredAtMs === null
      : rival.revealTriggeredAtMs !== null) &&
    (isRevealed === rival.cinematicCompleted) &&
    completionMatchesTimestamp(
      rival.introTransmissionCompleted,
      rival.introTransmissionCompletedAtMs,
    ) &&
    cinematicFlagsMatch &&
    scanFlagsMatch &&
    stageMatches &&
    progressionMatches
  )
}

function parseRival(
  value: unknown,
  playerSite: LandingSite,
): RivalSignalSnapshot | null {
  if (
    !isRecord(value) ||
    value.id !== RIVAL_SIGNAL_ID ||
    value.identityId !== RIVAL_IDENTITY_ID ||
    !isFiniteNumber(value.surfaceHeadingRad) ||
    normalizeLongitude(value.surfaceHeadingRad) !== value.surfaceHeadingRad ||
    !isRivalRevealStatus(value.revealStatus) ||
    !isNonNegativeNumber(value.createdAtMs) ||
    !isNonNegativeNumber(value.updatedAtMs) ||
    !isNullableTimestamp(value.revealTriggeredAtMs) ||
    (value.stage !== null && !isRivalStage(value.stage)) ||
    !isNullableTimestamp(value.stageChangedAtMs) ||
    typeof value.introTransmissionCompleted !== 'boolean' ||
    !isNullableTimestamp(value.introTransmissionCompletedAtMs) ||
    typeof value.cinematicCompleted !== 'boolean' ||
    !isNullableTimestamp(value.cinematicCompletedAtMs) ||
    typeof value.cinematicViewedOnce !== 'boolean' ||
    typeof value.replayEligible !== 'boolean' ||
    typeof value.skipEligible !== 'boolean' ||
    typeof value.scanCompleted !== 'boolean' ||
    !isNullableTimestamp(value.scanCompletedAtMs) ||
    typeof value.scanResponseCompleted !== 'boolean' ||
    !isNullableTimestamp(value.scanResponseCompletedAtMs)
  ) {
    return null
  }

  const site = parseLandingSite(value.canonicalLanding)

  if (
    site === null ||
    !sameCanonicalRivalSite(playerSite, site, value.surfaceHeadingRad)
  ) {
    return null
  }

  const parsed: RivalSignalSnapshot = {
    id: RIVAL_SIGNAL_ID,
    identityId: RIVAL_IDENTITY_ID,
    site,
    surfaceHeadingRad: value.surfaceHeadingRad,
    revealStatus: value.revealStatus,
    createdAtMs: value.createdAtMs,
    updatedAtMs: value.updatedAtMs,
    revealTriggeredAtMs: value.revealTriggeredAtMs,
    stage: value.stage,
    stageChangedAtMs: value.stageChangedAtMs,
    introTransmissionCompleted: value.introTransmissionCompleted,
    introTransmissionCompletedAtMs: value.introTransmissionCompletedAtMs,
    cinematicCompleted: value.cinematicCompleted,
    cinematicCompletedAtMs: value.cinematicCompletedAtMs,
    cinematicViewedOnce: value.cinematicViewedOnce,
    replayEligible: value.replayEligible,
    skipEligible: value.skipEligible,
    scanCompleted: value.scanCompleted,
    scanCompletedAtMs: value.scanCompletedAtMs,
    scanResponseCompleted: value.scanResponseCompleted,
    scanResponseCompletedAtMs: value.scanResponseCompletedAtMs,
  }

  return rivalStateIsConsistent(parsed) ? parsed : null
}

function ensureEligibleRivalState(
  outpost: OutpostSnapshot,
  rival: RivalSignalSnapshot,
  nowMs: number,
): RivalSignalSnapshot {
  if (
    outpost.extractor?.status === 'active' &&
    rival.revealStatus === 'DORMANT'
  ) {
    return createMigratedRivalSignal(outpost, nowMs)
  }

  return normalizeRivalSignalForResume(rival, nowMs)
}

function normalizePrototypeForResume(
  prototype: PrototypeSnapshot,
  nowMs: number,
): PrototypeSnapshot {
  const outpost = normalizeOutpostForResume(prototype.outpost, nowMs)
  const rival = ensureEligibleRivalState(outpost, prototype.rival, nowMs)

  return { outpost, rival }
}

function toEnvelope(
  prototype: PrototypeSnapshot,
  savedAtMs: number,
): PrototypeSaveEnvelopeV2 {
  const safe = normalizePrototypeForResume(prototype, savedAtMs)
  const { site: _outpostSite, ...outpostData } = safe.outpost
  const { site: _rivalSite, ...rivalData } = safe.rival

  return {
    schemaVersion: OUTPOST_SAVE_SCHEMA_VERSION,
    savedAtMs,
    canonicalLanding: toCanonicalLanding(safe.outpost.site),
    outpost: outpostData,
    rival: {
      ...rivalData,
      canonicalLanding: toCanonicalLanding(safe.rival.site),
    },
  }
}

export function serializePrototypeSave(
  prototype: PrototypeSnapshot,
  savedAtMs = Date.now(),
): string {
  if (!isNonNegativeNumber(savedAtMs)) {
    throw new RangeError('savedAtMs must be finite and non-negative.')
  }

  return JSON.stringify(toEnvelope(prototype, savedAtMs))
}

export function deserializePrototypeSave(
  serialized: string,
  nowMs = Date.now(),
): PrototypeSnapshot | null {
  let value: unknown

  try {
    value = JSON.parse(serialized)
  } catch {
    return null
  }

  if (
    !isRecord(value) ||
    (value.schemaVersion !== PRE_RIVAL_SAVE_SCHEMA_VERSION &&
      value.schemaVersion !== OUTPOST_SAVE_SCHEMA_VERSION) ||
    !isNonNegativeNumber(value.savedAtMs) ||
    !isNonNegativeNumber(nowMs)
  ) {
    return null
  }

  const outpost = parseOutpost(
    value.canonicalLanding,
    value.outpost,
    nowMs,
  )

  if (outpost === null) {
    return null
  }

  if (
    value.schemaVersion === PRE_RIVAL_SAVE_SCHEMA_VERSION ||
    value.rival === undefined ||
    value.rival === null
  ) {
    return {
      outpost,
      rival: createMigratedRivalSignal(outpost, nowMs),
    }
  }

  const parsedRival = parseRival(value.rival, outpost.site)

  if (parsedRival === null) {
    return null
  }

  return {
    outpost,
    rival: ensureEligibleRivalState(outpost, parsedRival, nowMs),
  }
}

export function loadPrototypeSave(
  storage: StorageLike,
  nowMs = Date.now(),
): PrototypeSnapshot | null {
  try {
    const serialized = storage.getItem(OUTPOST_STORAGE_KEY)
    return serialized === null
      ? null
      : deserializePrototypeSave(serialized, nowMs)
  } catch {
    return null
  }
}

export function writePrototypeSave(
  storage: StorageLike,
  prototype: PrototypeSnapshot,
  nowMs = Date.now(),
): boolean {
  try {
    storage.setItem(
      OUTPOST_STORAGE_KEY,
      serializePrototypeSave(prototype, nowMs),
    )
    return true
  } catch {
    return false
  }
}

/** Compatibility adapter for code that only consumes the player outpost. */
export function serializeOutpostSave(
  outpost: OutpostSnapshot,
  savedAtMs = Date.now(),
): string {
  const safeOutpost = normalizeOutpostForResume(outpost, savedAtMs)
  return serializePrototypeSave(
    {
      outpost,
      rival: createMigratedRivalSignal(safeOutpost, savedAtMs),
    },
    savedAtMs,
  )
}

/** Compatibility adapter for code that only consumes the player outpost. */
export function deserializeOutpostSave(
  serialized: string,
  nowMs = Date.now(),
): OutpostSnapshot | null {
  return deserializePrototypeSave(serialized, nowMs)?.outpost ?? null
}

/** Compatibility adapter for code that only consumes the player outpost. */
export function loadOutpostSave(
  storage: StorageLike,
  nowMs = Date.now(),
): OutpostSnapshot | null {
  return loadPrototypeSave(storage, nowMs)?.outpost ?? null
}

/** Compatibility adapter for code that only writes the player outpost. */
export function writeOutpostSave(
  storage: StorageLike,
  outpost: OutpostSnapshot,
  nowMs = Date.now(),
): boolean {
  try {
    storage.setItem(
      OUTPOST_STORAGE_KEY,
      serializeOutpostSave(outpost, nowMs),
    )
    return true
  } catch {
    return false
  }
}

export function resetPrototypeSave(storage: StorageLike): boolean {
  try {
    storage.removeItem(OUTPOST_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
