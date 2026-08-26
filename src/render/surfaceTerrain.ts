import { DEPOSIT_BLUEPRINTS, ROBOT_IDLE_POSITION } from '../domain/outpost.ts'
import type { LandingSite } from '../domain/lunarCoordinates.ts'
import {
  LOCAL_METRES_TO_RENDER_UNITS,
  LOCAL_SURFACE_HALF_SIZE_M,
  LOCAL_SURFACE_RENDER_OFFSET,
} from './localSurface.ts'

interface TerrainCrater {
  readonly xM: number
  readonly zM: number
  readonly radiusM: number
  readonly depthM: number
}

interface TerrainRidge {
  readonly xM: number
  readonly zM: number
  readonly radiusXM: number
  readonly radiusZM: number
  readonly rotationRad: number
  readonly heightM: number
}

export interface SurfaceTerrainProfile {
  readonly seed: number
  readonly craters: readonly TerrainCrater[]
  readonly ridges: readonly TerrainRidge[]
  readonly centerHeightM: number
}

export interface SurfaceRenderSample {
  readonly x: number
  readonly y: number
  readonly z: number
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function smoothValue(value: number): number {
  return value * value * (3 - 2 * value)
}

function hashGrid(x: number, z: number, seed: number): number {
  let value = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed
  value = Math.imul(value ^ (value >>> 13), 1274126177)
  return ((value ^ (value >>> 16)) >>> 0) / 0xffff_ffff
}

function valueNoise(x: number, z: number, seed: number): number {
  const cellX = Math.floor(x)
  const cellZ = Math.floor(z)
  const fractionX = smoothValue(x - cellX)
  const fractionZ = smoothValue(z - cellZ)
  const lowerLeft = hashGrid(cellX, cellZ, seed)
  const lowerRight = hashGrid(cellX + 1, cellZ, seed)
  const upperLeft = hashGrid(cellX, cellZ + 1, seed)
  const upperRight = hashGrid(cellX + 1, cellZ + 1, seed)
  const lower = lowerLeft + (lowerRight - lowerLeft) * fractionX
  const upper = upperLeft + (upperRight - upperLeft) * fractionX

  return lower + (upper - lower) * fractionZ
}

function fractalNoise(xM: number, zM: number, seed: number): number {
  let amplitude = 0.62
  let frequency = 0.045
  let value = 0
  let normalization = 0

  for (let octave = 0; octave < 4; octave += 1) {
    value +=
      (valueNoise(xM * frequency, zM * frequency, seed + octave * 977) * 2 - 1) *
      amplitude
    normalization += amplitude
    amplitude *= 0.46
    frequency *= 2.13
  }

  return value / normalization
}

function distanceToSegment(
  xM: number,
  zM: number,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
): number {
  const deltaX = endX - startX
  const deltaZ = endZ - startZ
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ
  const progress =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((xM - startX) * deltaX + (zM - startZ) * deltaZ) /
              lengthSquared,
          ),
        )
  return Math.hypot(
    xM - (startX + deltaX * progress),
    zM - (startZ + deltaZ * progress),
  )
}

function isWalkwayClear(
  xM: number,
  zM: number,
  radiusM: number,
): boolean {
  if (Math.hypot(xM, zM) < radiusM + 5.5) {
    return false
  }

  for (const deposit of DEPOSIT_BLUEPRINTS) {
    if (
      Math.hypot(xM - deposit.position.xM, zM - deposit.position.zM) <
      radiusM + 3.2
    ) {
      return false
    }

    const firstLeg = distanceToSegment(
      xM,
      zM,
      ROBOT_IDLE_POSITION.xM,
      ROBOT_IDLE_POSITION.zM,
      deposit.routeControl.xM,
      deposit.routeControl.zM,
    )
    const secondLeg = distanceToSegment(
      xM,
      zM,
      deposit.routeControl.xM,
      deposit.routeControl.zM,
      deposit.position.xM,
      deposit.position.zM,
    )

    if (Math.min(firstLeg, secondLeg) < radiusM + 2.4) {
      return false
    }
  }

  return true
}

function rawTerrainHeightM(
  seed: number,
  craters: readonly TerrainCrater[],
  ridges: readonly TerrainRidge[],
  xM: number,
  zM: number,
): number {
  let heightM =
    fractalNoise(xM, zM, seed + 313) * 0.3 +
    fractalNoise(xM * 2.4, zM * 2.4, seed + 991) * 0.075

  for (const crater of craters) {
    const normalizedDistance =
      Math.hypot(xM - crater.xM, zM - crater.zM) / crater.radiusM

    if (normalizedDistance < 0.78) {
      const bowl = 1 - normalizedDistance / 0.78
      heightM -= crater.depthM * bowl * bowl
    } else if (normalizedDistance < 1.28) {
      const rim = (normalizedDistance - 1) / 0.28
      heightM += crater.depthM * 0.42 * Math.exp(-rim * rim * 4.4)
    }
  }

  for (const ridge of ridges) {
    const cosine = Math.cos(ridge.rotationRad)
    const sine = Math.sin(ridge.rotationRad)
    const deltaX = xM - ridge.xM
    const deltaZ = zM - ridge.zM
    const localX = deltaX * cosine - deltaZ * sine
    const localZ = deltaX * sine + deltaZ * cosine
    const distanceSquared =
      (localX * localX) / (ridge.radiusXM * ridge.radiusXM) +
      (localZ * localZ) / (ridge.radiusZM * ridge.radiusZM)
    heightM += ridge.heightM * Math.exp(-distanceSquared * 2.2)
  }

  return heightM
}

export function createSurfaceTerrainProfile(
  site: LandingSite,
): SurfaceTerrainProfile {
  const seed =
    (Math.round((site.location.latitudeRad + Math.PI / 2) * 1_000_000) ^
      Math.round((site.location.longitudeRad + Math.PI) * 1_000_000) ^
      0x51e7ac3) >>>
    0
  const random = createRandom(seed)
  const craters: TerrainCrater[] = [
    { xM: 0, zM: -1, radiusM: 47, depthM: 1.45 },
    { xM: -29, zM: 15, radiusM: 13, depthM: 1.25 },
    { xM: 30, zM: 11, radiusM: 11, depthM: 0.95 },
    { xM: -72, zM: -44, radiusM: 29, depthM: 2.9 },
    { xM: 64, zM: -72, radiusM: 22, depthM: 2.1 },
    { xM: -94, zM: 48, radiusM: 38, depthM: 3.4 },
  ]

  for (let attempt = 0; attempt < 90 && craters.length < 23; attempt += 1) {
    const radiusM = 3.5 + random() * 12
    const xM = (random() * 2 - 1) * (LOCAL_SURFACE_HALF_SIZE_M - radiusM)
    const zM = (random() * 2 - 1) * (LOCAL_SURFACE_HALF_SIZE_M - radiusM)

    if (!isWalkwayClear(xM, zM, radiusM)) {
      continue
    }

    craters.push({
      xM,
      zM,
      radiusM,
      depthM: radiusM * (0.065 + random() * 0.055),
    })
  }

  const ridges: TerrainRidge[] = [
    {
      xM: -30,
      zM: -48,
      radiusXM: 34,
      radiusZM: 6,
      rotationRad: 0.23,
      heightM: 1.05,
    },
    {
      xM: 34,
      zM: -55,
      radiusXM: 31,
      radiusZM: 7,
      rotationRad: -0.31,
      heightM: 0.92,
    },
    {
      xM: -88,
      zM: -108,
      radiusXM: 66,
      radiusZM: 13,
      rotationRad: 0.28,
      heightM: 1.75,
    },
    {
      xM: 92,
      zM: -128,
      radiusXM: 58,
      radiusZM: 15,
      rotationRad: -0.36,
      heightM: 1.4,
    },
    {
      xM: -126,
      zM: 68,
      radiusXM: 48,
      radiusZM: 12,
      rotationRad: -0.72,
      heightM: 1.1,
    },
  ]
  const centerHeightM = rawTerrainHeightM(seed, craters, ridges, 0, 0)

  return { seed, craters, ridges, centerHeightM }
}

export function sampleTerrainHeightM(
  profile: SurfaceTerrainProfile,
  xM: number,
  zM: number,
): number {
  return (
    rawTerrainHeightM(profile.seed, profile.craters, profile.ridges, xM, zM) -
    profile.centerHeightM
  )
}

export function localSurfaceToRender(
  profile: SurfaceTerrainProfile,
  xM: number,
  zM: number,
): SurfaceRenderSample {
  const x = xM * LOCAL_METRES_TO_RENDER_UNITS
  const z = zM * LOCAL_METRES_TO_RENDER_UNITS
  const halfSizeRender =
    LOCAL_SURFACE_HALF_SIZE_M * LOCAL_METRES_TO_RENDER_UNITS
  const edgeDistance = Math.max(Math.abs(x), Math.abs(z)) / halfSizeRender
  const edgeBlend = smoothValue(Math.max(0, 1 - edgeDistance))
  const sphereCurve = Math.sqrt(Math.max(0, 1 - x * x - z * z)) - 1
  const relief =
    sampleTerrainHeightM(profile, xM, zM) * LOCAL_METRES_TO_RENDER_UNITS

  return {
    x,
    y:
      sphereCurve +
      (LOCAL_SURFACE_RENDER_OFFSET + relief) * edgeBlend,
    z,
  }
}

export function siteTerrainSeed(site: LandingSite, salt: number): number {
  return (
    Math.round(site.location.latitudeRad * 10_000_000) ^
    Math.round(site.location.longitudeRad * 10_000_000) ^
    salt
  ) >>> 0
}
