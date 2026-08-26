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
  type LandingSite,
  type QuaternionData,
} from '../domain/lunarCoordinates.ts'

export const OUTPOST_SAVE_SCHEMA_VERSION = 1
export const OUTPOST_STORAGE_KEY = 'shoot-the-moon:first-outpost:v1'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface CanonicalLandingSave {
  readonly datumId: string
  readonly latitudeRad: number
  readonly longitudeRad: number
  readonly altitudeM: number
  readonly orientationMcmf: QuaternionData
}

interface OutpostSaveEnvelope {
  readonly schemaVersion: typeof OUTPOST_SAVE_SCHEMA_VERSION
  readonly savedAtMs: number
  readonly canonicalLanding: CanonicalLandingSave
  readonly outpost: Omit<OutpostSnapshot, 'site'>
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

function normalizeForResume(
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

function toEnvelope(
  outpost: OutpostSnapshot,
  savedAtMs: number,
): OutpostSaveEnvelope {
  const safeOutpost = normalizeForResume(outpost, savedAtMs)
  const { site: _site, ...outpostData } = safeOutpost

  return {
    schemaVersion: OUTPOST_SAVE_SCHEMA_VERSION,
    savedAtMs,
    canonicalLanding: {
      datumId: safeOutpost.site.datumId,
      latitudeRad: safeOutpost.site.location.latitudeRad,
      longitudeRad: safeOutpost.site.location.longitudeRad,
      altitudeM: safeOutpost.site.location.heightM,
      orientationMcmf: safeOutpost.site.orientationMcmf,
    },
    outpost: outpostData,
  }
}

export function serializeOutpostSave(
  outpost: OutpostSnapshot,
  savedAtMs = Date.now(),
): string {
  return JSON.stringify(toEnvelope(outpost, savedAtMs))
}

export function deserializeOutpostSave(
  serialized: string,
  nowMs = Date.now(),
): OutpostSnapshot | null {
  let value: unknown

  try {
    value = JSON.parse(serialized)
  } catch {
    return null
  }

  if (
    !isRecord(value) ||
    value.schemaVersion !== OUTPOST_SAVE_SCHEMA_VERSION ||
    !isNonNegativeNumber(value.savedAtMs) ||
    !isRecord(value.outpost)
  ) {
    return null
  }

  const site = parseLandingSite(value.canonicalLanding)
  const data = value.outpost

  if (
    site === null ||
    data.id !== OUTPOST_ID ||
    !isOutpostStage(data.stage) ||
    !isNonNegativeNumber(data.establishedAtMs) ||
    !isNonNegativeNumber(data.updatedAtMs) ||
    !isNonNegativeNumber(data.lunarOre) ||
    !isRecord(data.robot) ||
    data.robot.id !== MINER_ID ||
    !isRobotState(data.robot.state) ||
    !isNonNegativeNumber(data.robot.stateStartedAtMs) ||
    (data.robot.targetDepositId !== null &&
      typeof data.robot.targetDepositId !== 'string') ||
    !isNonNegativeNumber(data.robot.carriedOre) ||
    !Array.isArray(data.deposits) ||
    data.deposits.length !== DEPOSIT_BLUEPRINTS.length
  ) {
    return null
  }

  const deposits = data.deposits.map(parseDeposit)

  if (
    deposits.some((deposit) => deposit === null) ||
    new Set(deposits.map((deposit) => deposit?.id)).size !==
      DEPOSIT_BLUEPRINTS.length
  ) {
    return null
  }

  const extractor = parseExtractor(data.extractor)

  if (extractor === undefined) {
    return null
  }

  const parsed: OutpostSnapshot = {
    id: OUTPOST_ID,
    site,
    stage: data.stage,
    establishedAtMs: data.establishedAtMs,
    updatedAtMs: data.updatedAtMs,
    lunarOre: data.lunarOre,
    robot: {
      id: MINER_ID,
      state: data.robot.state,
      stateStartedAtMs: data.robot.stateStartedAtMs,
      targetDepositId: data.robot.targetDepositId,
      carriedOre: data.robot.carriedOre,
    },
    deposits: deposits as readonly MineralDeposit[],
    extractor,
  }

  return normalizeForResume(parsed, nowMs)
}

export function loadOutpostSave(
  storage: StorageLike,
  nowMs = Date.now(),
): OutpostSnapshot | null {
  try {
    const serialized = storage.getItem(OUTPOST_STORAGE_KEY)
    return serialized === null
      ? null
      : deserializeOutpostSave(serialized, nowMs)
  } catch {
    return null
  }
}

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
