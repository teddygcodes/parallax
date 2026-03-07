/**
 * Server-side proxy for CelesTrak GP OMM data.
 * Fetches the 10 imaging satellites by NORAD ID, bypassing browser CORS restrictions.
 * Falls back to hardcoded orbital elements when CelesTrak is unreachable.
 */
import { NextResponse } from 'next/server'

const NORAD_IDS = [39634, 41456, 47506, 47507, 47380, 47381, 40697, 42063, 39084, 49260]
const CATNR = NORAD_IDS.join(',')
const CELESTRAK_URL = `https://celestrak.org/GP/GP.php?CATNR=${CATNR}&FORMAT=json`

/**
 * Fallback OMM data — approximate orbital elements for the 10 imaging satellites.
 * Used when CelesTrak is unreachable. Epoch 2026-03-06T00:00:00Z (today).
 * Satellites marked isStale in SatelliteLayer because epoch > 24h threshold is
 * evaluated client-side; these elements are intentionally set to a fixed recent date
 * so the propagator produces valid positions across demonstration sessions.
 *
 * RAAN values spread across orbital planes for good global coverage in demo mode.
 * Mean anomaly values distribute satellites around their orbits.
 */
const FALLBACK_OMM = [
  // ── SAR satellites ──────────────────────────────────────────────────────────
  {
    CCSDS_OMM_VERS: '2.0', OBJECT_NAME: 'SENTINEL-1A', OBJECT_ID: '2014-016A',
    EPOCH: '2026-03-06T00:00:00.000000',
    MEAN_MOTION: '14.59197541', ECCENTRICITY: '.0001459', INCLINATION: '98.1814',
    RA_OF_ASC_NODE: '48.2341',  ARG_OF_PERICENTER: '85.4278',  MEAN_ANOMALY: '102.3456',
    EPHEMERIS_TYPE: '0', CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: '39634',
    ELEMENT_SET_NO: '999', REV_AT_EPOCH: '12180', BSTAR: '.10000E-3',
    MEAN_MOTION_DOT: '.103940E-5', MEAN_MOTION_DDOT: '0',
  },
  {
    CCSDS_OMM_VERS: '2.0', OBJECT_NAME: 'SENTINEL-1B', OBJECT_ID: '2016-025A',
    EPOCH: '2026-03-06T00:00:00.000000',
    MEAN_MOTION: '14.59197541', ECCENTRICITY: '.0001515', INCLINATION: '98.1814',
    RA_OF_ASC_NODE: '228.7654',  ARG_OF_PERICENTER: '91.2345', MEAN_ANOMALY: '287.6543',
    EPHEMERIS_TYPE: '0', CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: '41456',
    ELEMENT_SET_NO: '999', REV_AT_EPOCH: '9420', BSTAR: '.10000E-3',
    MEAN_MOTION_DOT: '.103940E-5', MEAN_MOTION_DDOT: '0',
  },
  {
    CCSDS_OMM_VERS: '2.0', OBJECT_NAME: 'ICEYE-X7', OBJECT_ID: '2021-006F',
    EPOCH: '2026-03-06T00:00:00.000000',
    MEAN_MOTION: '14.92712134', ECCENTRICITY: '.0002100', INCLINATION: '97.6840',
    RA_OF_ASC_NODE: '132.1234',  ARG_OF_PERICENTER: '77.3456', MEAN_ANOMALY: '45.2345',
    EPHEMERIS_TYPE: '0', CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: '47506',
    ELEMENT_SET_NO: '999', REV_AT_EPOCH: '8640', BSTAR: '.12000E-3',
    MEAN_MOTION_DOT: '.120000E-5', MEAN_MOTION_DDOT: '0',
  },
  {
    CCSDS_OMM_VERS: '2.0', OBJECT_NAME: 'ICEYE-X8', OBJECT_ID: '2021-006G',
    EPOCH: '2026-03-06T00:00:00.000000',
    MEAN_MOTION: '14.92712134', ECCENTRICITY: '.0002200', INCLINATION: '97.6840',
    RA_OF_ASC_NODE: '312.5678',  ARG_OF_PERICENTER: '81.2345', MEAN_ANOMALY: '220.7654',
    EPHEMERIS_TYPE: '0', CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: '47507',
    ELEMENT_SET_NO: '999', REV_AT_EPOCH: '8641', BSTAR: '.12000E-3',
    MEAN_MOTION_DOT: '.120000E-5', MEAN_MOTION_DDOT: '0',
  },
  {
    CCSDS_OMM_VERS: '2.0', OBJECT_NAME: 'CAPELLA-3', OBJECT_ID: '2021-006C',
    EPOCH: '2026-03-06T00:00:00.000000',
    MEAN_MOTION: '15.05209831', ECCENTRICITY: '.0001800', INCLINATION: '97.5541',
    RA_OF_ASC_NODE: '175.4321',  ARG_OF_PERICENTER: '92.1234', MEAN_ANOMALY: '161.2345',
    EPHEMERIS_TYPE: '0', CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: '47380',
    ELEMENT_SET_NO: '999', REV_AT_EPOCH: '8500', BSTAR: '.11000E-3',
    MEAN_MOTION_DOT: '.110000E-5', MEAN_MOTION_DDOT: '0',
  },
  {
    CCSDS_OMM_VERS: '2.0', OBJECT_NAME: 'CAPELLA-4', OBJECT_ID: '2021-006D',
    EPOCH: '2026-03-06T00:00:00.000000',
    MEAN_MOTION: '15.05209831', ECCENTRICITY: '.0001900', INCLINATION: '97.5541',
    RA_OF_ASC_NODE: '355.8765',  ARG_OF_PERICENTER: '88.9876', MEAN_ANOMALY: '335.6789',
    EPHEMERIS_TYPE: '0', CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: '47381',
    ELEMENT_SET_NO: '999', REV_AT_EPOCH: '8501', BSTAR: '.11000E-3',
    MEAN_MOTION_DOT: '.110000E-5', MEAN_MOTION_DDOT: '0',
  },
  // ── OPTICAL satellites ───────────────────────────────────────────────────────
  {
    CCSDS_OMM_VERS: '2.0', OBJECT_NAME: 'SENTINEL-2A', OBJECT_ID: '2015-028A',
    EPOCH: '2026-03-06T00:00:00.000000',
    MEAN_MOTION: '14.30121522', ECCENTRICITY: '.0000987', INCLINATION: '98.5676',
    RA_OF_ASC_NODE: '89.3456',  ARG_OF_PERICENTER: '90.2345', MEAN_ANOMALY: '72.1234',
    EPHEMERIS_TYPE: '0', CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: '40697',
    ELEMENT_SET_NO: '999', REV_AT_EPOCH: '11180', BSTAR: '.80000E-4',
    MEAN_MOTION_DOT: '.800000E-6', MEAN_MOTION_DDOT: '0',
  },
  {
    CCSDS_OMM_VERS: '2.0', OBJECT_NAME: 'SENTINEL-2B', OBJECT_ID: '2017-013A',
    EPOCH: '2026-03-06T00:00:00.000000',
    MEAN_MOTION: '14.30121522', ECCENTRICITY: '.0001023', INCLINATION: '98.5676',
    RA_OF_ASC_NODE: '269.7890',  ARG_OF_PERICENTER: '89.5678', MEAN_ANOMALY: '253.4567',
    EPHEMERIS_TYPE: '0', CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: '42063',
    ELEMENT_SET_NO: '999', REV_AT_EPOCH: '9820', BSTAR: '.80000E-4',
    MEAN_MOTION_DOT: '.800000E-6', MEAN_MOTION_DDOT: '0',
  },
  {
    CCSDS_OMM_VERS: '2.0', OBJECT_NAME: 'LANDSAT-8', OBJECT_ID: '2013-008A',
    EPOCH: '2026-03-06T00:00:00.000000',
    MEAN_MOTION: '14.57319837', ECCENTRICITY: '.0000734', INCLINATION: '98.2192',
    RA_OF_ASC_NODE: '142.6789',  ARG_OF_PERICENTER: '93.4567', MEAN_ANOMALY: '186.7890',
    EPHEMERIS_TYPE: '0', CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: '39084',
    ELEMENT_SET_NO: '999', REV_AT_EPOCH: '12420', BSTAR: '.75000E-4',
    MEAN_MOTION_DOT: '.750000E-6', MEAN_MOTION_DDOT: '0',
  },
  {
    CCSDS_OMM_VERS: '2.0', OBJECT_NAME: 'LANDSAT-9', OBJECT_ID: '2021-088A',
    EPOCH: '2026-03-06T00:00:00.000000',
    MEAN_MOTION: '14.57319837', ECCENTRICITY: '.0000812', INCLINATION: '98.2192',
    RA_OF_ASC_NODE: '322.3456',  ARG_OF_PERICENTER: '91.8901', MEAN_ANOMALY: '10.9876',
    EPHEMERIS_TYPE: '0', CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: '49260',
    ELEMENT_SET_NO: '999', REV_AT_EPOCH: '6180', BSTAR: '.75000E-4',
    MEAN_MOTION_DOT: '.750000E-6', MEAN_MOTION_DDOT: '0',
  },
]

export async function GET() {
  // Try live CelesTrak data first (server-side, no CORS restriction)
  try {
    const res = await fetch(CELESTRAK_URL, {
      next: { revalidate: 21600 }, // 6h server-side cache
      headers: { 'Accept': 'application/json' },
    })
    if (res.ok) {
      const data = await res.json()
      return NextResponse.json(data, {
        headers: { 'Cache-Control': 'public, max-age=21600' },
      })
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback: return hardcoded orbital elements
  // SatelliteLayer will set isStale = true since epoch > 24h on subsequent days,
  // which is honest about the data provenance in those sessions.
  return NextResponse.json(FALLBACK_OMM, {
    headers: { 'Cache-Control': 'public, max-age=3600' }, // 1h for fallback
  })
}
