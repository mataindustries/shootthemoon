export const HALF_PI = Math.PI / 2
export const TAU = Math.PI * 2

const POLE_EPSILON = 1e-12
const VECTOR_EPSILON = 1e-15

export interface Vec3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface QuaternionData {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly w: number
}

export interface LunarDatum {
  readonly id: string
  readonly referenceRadiusM: number
}

export interface LunarLocation {
  readonly latitudeRad: number
  readonly longitudeRad: number
  readonly heightM: number
}

export interface LandingSite {
  readonly datumId: string
  readonly location: LunarLocation
  readonly orientationMcmf: QuaternionData
}

export interface TangentBasis {
  readonly east: Vec3
  readonly up: Vec3
  readonly south: Vec3
}

export interface Ray3 {
  readonly origin: Vec3
  readonly direction: Vec3
}

export const MEAN_LUNAR_DATUM: LunarDatum = Object.freeze({
  id: 'moon-mean-radius-1737400m-v1',
  referenceRadiusM: 1_737_400,
})

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(name + ' must be finite.')
  }
}

function magnitudeSquared(vector: Vec3): number {
  return vector.x * vector.x + vector.y * vector.y + vector.z * vector.z
}

function scale(vector: Vec3, factor: number): Vec3 {
  return {
    x: vector.x * factor,
    y: vector.y * factor,
    z: vector.z * factor,
  }
}

function subtract(left: Vec3, right: Vec3): Vec3 {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  }
}

function add(left: Vec3, right: Vec3): Vec3 {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  }
}

export function dot(left: Vec3, right: Vec3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z
}

export function cross(left: Vec3, right: Vec3): Vec3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  }
}

export function magnitude(vector: Vec3): number {
  return Math.sqrt(magnitudeSquared(vector))
}

export function normalizeVector(vector: Vec3): Vec3 {
  const length = magnitude(vector)

  if (length <= VECTOR_EPSILON) {
    throw new RangeError('Cannot normalize a zero-length vector.')
  }

  return scale(vector, 1 / length)
}

export function normalizeLongitude(longitudeRad: number): number {
  assertFiniteNumber(longitudeRad, 'longitudeRad')

  const normalized = ((longitudeRad + Math.PI) % TAU + TAU) % TAU - Math.PI
  return Object.is(normalized, -0) ? 0 : normalized
}

export function createLunarLocation(
  latitudeRad: number,
  longitudeRad: number,
  heightM = 0,
): LunarLocation {
  assertFiniteNumber(latitudeRad, 'latitudeRad')
  assertFiniteNumber(heightM, 'heightM')

  if (latitudeRad < -HALF_PI || latitudeRad > HALF_PI) {
    throw new RangeError('latitudeRad must be between -π/2 and +π/2.')
  }

  const isPole = Math.abs(Math.abs(latitudeRad) - HALF_PI) <= POLE_EPSILON

  return Object.freeze({
    latitudeRad,
    longitudeRad: isPole ? 0 : normalizeLongitude(longitudeRad),
    heightM,
  })
}

export function lunarLocationToMcmf(
  location: LunarLocation,
  datum: LunarDatum = MEAN_LUNAR_DATUM,
): Vec3 {
  const validLocation = createLunarLocation(
    location.latitudeRad,
    location.longitudeRad,
    location.heightM,
  )
  const radiusM = datum.referenceRadiusM + validLocation.heightM

  if (!Number.isFinite(datum.referenceRadiusM) || datum.referenceRadiusM <= 0) {
    throw new RangeError('datum.referenceRadiusM must be positive and finite.')
  }

  if (radiusM <= 0) {
    throw new RangeError('A lunar location radius must be positive.')
  }

  const cosLatitude = Math.cos(validLocation.latitudeRad)

  return {
    x: radiusM * cosLatitude * Math.cos(validLocation.longitudeRad),
    y: radiusM * Math.sin(validLocation.latitudeRad),
    z: -radiusM * cosLatitude * Math.sin(validLocation.longitudeRad),
  }
}

export function mcmfToLunarLocation(
  position: Vec3,
  datum: LunarDatum = MEAN_LUNAR_DATUM,
): LunarLocation {
  const radiusM = magnitude(position)

  if (!Number.isFinite(datum.referenceRadiusM) || datum.referenceRadiusM <= 0) {
    throw new RangeError('datum.referenceRadiusM must be positive and finite.')
  }

  if (!Number.isFinite(radiusM) || radiusM <= VECTOR_EPSILON) {
    throw new RangeError('The MCMF zero vector has no lunar location.')
  }

  const latitudeRad = Math.asin(
    Math.max(-1, Math.min(1, position.y / radiusM)),
  )
  const longitudeRad =
    Math.abs(Math.abs(latitudeRad) - HALF_PI) <= POLE_EPSILON
      ? 0
      : Math.atan2(-position.z, position.x)

  return createLunarLocation(
    latitudeRad,
    longitudeRad,
    radiusM - datum.referenceRadiusM,
  )
}

export function tangentBasis(location: LunarLocation): TangentBasis {
  const validLocation = createLunarLocation(
    location.latitudeRad,
    location.longitudeRad,
    location.heightM,
  )
  const sinLatitude = Math.sin(validLocation.latitudeRad)
  const cosLatitude = Math.cos(validLocation.latitudeRad)
  const sinLongitude = Math.sin(validLocation.longitudeRad)
  const cosLongitude = Math.cos(validLocation.longitudeRad)

  const east = {
    x: -sinLongitude,
    y: 0,
    z: -cosLongitude,
  }
  const up = {
    x: cosLatitude * cosLongitude,
    y: sinLatitude,
    z: -cosLatitude * sinLongitude,
  }
  const south = {
    x: sinLatitude * cosLongitude,
    y: -cosLatitude,
    z: -sinLatitude * sinLongitude,
  }

  return { east, up, south }
}

export function mcmfToLocalTangent(
  position: Vec3,
  anchor: LunarLocation,
  metresPerUnit = 1,
  datum: LunarDatum = MEAN_LUNAR_DATUM,
): Vec3 {
  assertFiniteNumber(metresPerUnit, 'metresPerUnit')

  if (metresPerUnit <= 0) {
    throw new RangeError('metresPerUnit must be positive.')
  }

  const origin = lunarLocationToMcmf(anchor, datum)
  const delta = subtract(position, origin)
  const basis = tangentBasis(anchor)

  return {
    x: dot(delta, basis.east) / metresPerUnit,
    y: dot(delta, basis.up) / metresPerUnit,
    z: dot(delta, basis.south) / metresPerUnit,
  }
}

export function localTangentToMcmf(
  position: Vec3,
  anchor: LunarLocation,
  metresPerUnit = 1,
  datum: LunarDatum = MEAN_LUNAR_DATUM,
): Vec3 {
  assertFiniteNumber(metresPerUnit, 'metresPerUnit')

  if (metresPerUnit <= 0) {
    throw new RangeError('metresPerUnit must be positive.')
  }

  const origin = lunarLocationToMcmf(anchor, datum)
  const basis = tangentBasis(anchor)
  const offset = add(
    add(
      scale(basis.east, position.x * metresPerUnit),
      scale(basis.up, position.y * metresPerUnit),
    ),
    scale(basis.south, position.z * metresPerUnit),
  )

  return add(origin, offset)
}

export function surfaceUnitVector(location: LunarLocation): Vec3 {
  return normalizeVector(lunarLocationToMcmf(location))
}

function quaternionFromBasis(basis: TangentBasis): QuaternionData {
  const m00 = basis.east.x
  const m01 = basis.up.x
  const m02 = basis.south.x
  const m10 = basis.east.y
  const m11 = basis.up.y
  const m12 = basis.south.y
  const m20 = basis.east.z
  const m21 = basis.up.z
  const m22 = basis.south.z
  const trace = m00 + m11 + m22

  let x: number
  let y: number
  let z: number
  let w: number

  if (trace > 0) {
    const size = Math.sqrt(trace + 1) * 2
    w = 0.25 * size
    x = (m21 - m12) / size
    y = (m02 - m20) / size
    z = (m10 - m01) / size
  } else if (m00 > m11 && m00 > m22) {
    const size = Math.sqrt(1 + m00 - m11 - m22) * 2
    w = (m21 - m12) / size
    x = 0.25 * size
    y = (m01 + m10) / size
    z = (m02 + m20) / size
  } else if (m11 > m22) {
    const size = Math.sqrt(1 + m11 - m00 - m22) * 2
    w = (m02 - m20) / size
    x = (m01 + m10) / size
    y = 0.25 * size
    z = (m12 + m21) / size
  } else {
    const size = Math.sqrt(1 + m22 - m00 - m11) * 2
    w = (m10 - m01) / size
    x = (m02 + m20) / size
    y = (m12 + m21) / size
    z = 0.25 * size
  }

  const quaternionLength = Math.hypot(x, y, z, w)

  return {
    x: x / quaternionLength,
    y: y / quaternionLength,
    z: z / quaternionLength,
    w: w / quaternionLength,
  }
}

export function createLandingSite(
  location: LunarLocation,
  datum: LunarDatum = MEAN_LUNAR_DATUM,
): LandingSite {
  const validLocation = createLunarLocation(
    location.latitudeRad,
    location.longitudeRad,
    location.heightM,
  )

  return Object.freeze({
    datumId: datum.id,
    location: validLocation,
    orientationMcmf: Object.freeze(
      quaternionFromBasis(tangentBasis(validLocation)),
    ),
  })
}

export function intersectRayWithSphere(
  ray: Ray3,
  radius: number,
  center: Vec3 = { x: 0, y: 0, z: 0 },
): Vec3 | null {
  assertFiniteNumber(radius, 'radius')

  if (radius <= 0) {
    throw new RangeError('radius must be positive.')
  }

  const directionLengthSquared = magnitudeSquared(ray.direction)

  if (
    !Number.isFinite(directionLengthSquared) ||
    directionLengthSquared <= VECTOR_EPSILON
  ) {
    throw new RangeError('Ray direction must be non-zero and finite.')
  }

  const relativeOrigin = subtract(ray.origin, center)
  const a = directionLengthSquared
  const b = 2 * dot(relativeOrigin, ray.direction)
  const c = magnitudeSquared(relativeOrigin) - radius * radius
  const discriminant = b * b - 4 * a * c

  if (discriminant < -VECTOR_EPSILON) {
    return null
  }

  const root = Math.sqrt(Math.max(0, discriminant))
  const nearDistance = (-b - root) / (2 * a)
  const farDistance = (-b + root) / (2 * a)
  const distance =
    nearDistance >= 0 ? nearDistance : farDistance >= 0 ? farDistance : null

  if (distance === null) {
    return null
  }

  return add(ray.origin, scale(ray.direction, distance))
}

