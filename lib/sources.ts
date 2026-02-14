import { GeoPoint } from "./types";

const DEFAULT_TIMEOUT_MS = 12000;

async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Request failed ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(id);
  }
}

export type GeocodeResult = {
  matchedAddress?: string;
  location: GeoPoint;
};

export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const addressVariations = [
    address, // Original
    address.replace(/^[A-Z]One\s/, "One "), // Fix "EOne" typo
    address.split(",").slice(0, -1).join(",").trim(), // Remove ZIP code
    address.split(",").slice(1).join(",").trim() // City, State, ZIP only
  ];

  // Try Census Geocoder first (most accurate for US)
  for (const addr of addressVariations) {
    try {
      const encoded = encodeURIComponent(addr);
      const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encoded}&benchmark=Public_AR_Current&format=json`;
      const data = await fetchJson<any>(url, undefined, 8000);
      const match = data?.result?.addressMatches?.[0];

      if (match?.coordinates) {
        return {
          matchedAddress: match.matchedAddress,
          location: { lat: match.coordinates.y, lon: match.coordinates.x }
        };
      }
    } catch (err) {
      // Try next variation
      continue;
    }
  }

  // Fallback: Try OpenStreetMap Nominatim (free, no API key)
  try {
    const encoded = encodeURIComponent(address);
    const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1`;
    // Nominatim requires a User-Agent header
    const data = await fetchJson<any>(url, {
      headers: {
        'User-Agent': 'construction-site-intel/1.0 (site-intelligence-app)'
      }
    }, 8000);

    if (data && Array.isArray(data) && data.length > 0) {
      const match = data[0];
      return {
        matchedAddress: match.display_name || address,
        location: {
          lat: parseFloat(match.lat),
          lon: parseFloat(match.lon)
        }
      };
    }
  } catch (err) {
    // Nominatim failed too
  }

  throw new Error(
    `Could not geocode address: "${address}". ` +
    `Please try a different address format (e.g., "123 Main St, City, State" or "City, State"). ` +
    `The geocoder works best with standard US addresses in official databases.`
  );
}

export type USGSDesignData = {
  sdc?: string;
  sds?: number;
  sd1?: number;
  pga?: number;
  ss?: number;
  s1?: number;
};

export async function fetchUSGSDesignMap(point: GeoPoint): Promise<USGSDesignData> {
  const url = `https://earthquake.usgs.gov/ws/designmaps/asce7-16.json?latitude=${point.lat}&longitude=${point.lon}&riskCategory=II&siteClass=C&title=Construction%20Site`;
  try {
    const data = await fetchJson<any>(url);
    const payload = data?.response?.data ?? data?.data ?? {};
    return {
      sdc: payload?.sdc,
      sds: payload?.sds,
      sd1: payload?.sd1,
      pga: payload?.pga,
      ss: payload?.ss,
      s1: payload?.s1
    };
  } catch (err) {
    // Return empty if USGS service fails
    return {
      sdc: undefined,
      sds: undefined,
      sd1: undefined,
      pga: undefined,
      ss: undefined,
      s1: undefined
    };
  }
}

export type FEMAData = {
  floodZone?: string;
  zoneSubtype?: string;
  staticBfe?: number | null;
  firmPanel?: string;
};

export async function fetchFEMAFloodZone(point: GeoPoint): Promise<FEMAData> {
  const url = `https://services.arcgis.com/2gdL2gxYNFY2TOUb/arcgis/rest/services/FEMA_National_Flood_Hazard_Layer/FeatureServer/0/query?geometry=${point.lon},${point.lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE,ZONE_SUBTY,STATIC_BFE,DFIRM_ID&f=json`;
  try {
    const data = await fetchJson<any>(url);
    const feature = data?.features?.[0]?.attributes;
    if (feature && feature.FLD_ZONE) {
      return {
        floodZone: feature.FLD_ZONE,
        zoneSubtype: feature?.ZONE_SUBTY ?? undefined,
        staticBfe: feature?.STATIC_BFE ?? null,
        firmPanel: feature?.DFIRM_ID ?? undefined
      };
    }
    // Location is outside mapped FEMA areas (Zone X)
    return {
      floodZone: "X",
      zoneSubtype: "Outside mapped areas",
      staticBfe: null,
      firmPanel: undefined
    };
  } catch (err) {
    // On error, default to Zone X (outside mapped areas)
    return {
      floodZone: "X",
      zoneSubtype: "Outside mapped areas",
      staticBfe: null,
      firmPanel: undefined
    };
  }
}

export type SoilData = {
  compname?: string;
  hydrologicGroup?: string;
  drainageClass?: string;
  restrictiveDepthCm?: number | null;
  clayPercent?: number | null;
};

export type FireHazardData = {
  wildfireRisk?: "low" | "medium" | "high" | "very high";
  fireZoneCategory?: string;
  fireOccurrenceHistoryYears?: number;
};

export type ClimateData = {
  designWindMph?: number | null;
  annualSnowCm?: number | null;
  p90AnnualSnowCm?: number | null;
  p50AnnualSnowCm?: number | null;
  analysisYears?: number | null;
  source?: string;
};

function buildWkt(point: GeoPoint, delta = 0.00025): string {
  const minLat = point.lat - delta;
  const maxLat = point.lat + delta;
  const minLon = point.lon - delta;
  const maxLon = point.lon + delta;
  return `POLYGON((${minLon} ${minLat}, ${minLon} ${maxLat}, ${maxLon} ${maxLat}, ${maxLon} ${minLat}, ${minLon} ${minLat}))`;
}

async function sdaQuery(sql: string, maxRetries = 3): Promise<any[]> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // CRITICAL: Include format=JSON to get JSON response instead of XML
      const body = new URLSearchParams({ query: sql, format: "JSON" }).toString();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const res = await fetch("https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`SDA request failed ${res.status}`);
      }

      const data = await res.json();
      return data?.Table ?? [];
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < maxRetries - 1) {
        // Exponential backoff: 100ms, 250ms, 625ms
        const delay = Math.pow(2.5, attempt) * 100;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error("SDA query failed after retries");
}

// Fallback: Query NRCS Web Soil Survey via MapServer
async function fetchNRCSSoilData(point: GeoPoint): Promise<SoilData> {
  try {
    const url = `https://sdmdataaccess.nrcs.usda.gov/Tabular/post.rest`;
    const wkt = buildWkt(point, 0.0005); // Slightly larger buffer for fallback

    // Try to get component data directly
    const sql = `SELECT TOP 1 compname, hydgrp, drainagecl 
      FROM component 
      WHERE mukey IN (SELECT mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('${wkt}'))
      ORDER BY comppct_r DESC`;

    const body = new URLSearchParams({ query: sql, format: "JSON" }).toString();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10000)
    });

    if (!res.ok) throw new Error(`NRCS query failed ${res.status}`);

    const data = await res.json();
    const row = data?.Table?.[0];

    return {
      compname: Array.isArray(row) ? row[0] : row?.compname,
      hydrologicGroup: Array.isArray(row) ? row[1] : row?.hydgrp,
      drainageClass: Array.isArray(row) ? row[2] : row?.drainagecl,
      restrictiveDepthCm: null,
      clayPercent: null
    };
  } catch (err) {
    throw new Error(`NRCS fallback failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function fetchSoils(point: GeoPoint): Promise<SoilData> {
  try {
    // Step 1: Get mukey from location
    const wkt = buildWkt(point);
    const mukeySql = `SELECT DISTINCT mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('${wkt}')`;
    const mukeyRows = await sdaQuery(mukeySql, 3);

    if (!mukeyRows || mukeyRows.length === 0) {
      throw new Error("No map unit found at location");
    }

    // Extract mukey from response (comes as array of arrays)
    const mukey = Array.isArray(mukeyRows[0]) ? mukeyRows[0][0] : mukeyRows[0];

    if (!mukey) {
      throw new Error("Could not extract mukey from response");
    }

    // Step 2: Get component data (comppct_r, hydgrp, drainagecl)
    const compSql = `SELECT TOP 1 compname, comppct_r, hydgrp, drainagecl FROM component WHERE mukey = '${mukey}' ORDER BY comppct_r DESC`;
    const compRows = await sdaQuery(compSql, 3);

    // Step 3: Get horizon data for clay content
    const horizonSql = `SELECT TOP 1 claytotal_r FROM chorizon ch INNER JOIN component c ON c.cokey = ch.cokey WHERE c.mukey = '${mukey}' ORDER BY ch.hzdept_r ASC`;
    const horizonRows = await sdaQuery(horizonSql, 2);

    // Parse component data (comes as array of [compname, comppct_r, hydgrp, drainagecl])
    let compData: any = {};
    if (compRows && compRows.length > 0) {
      const row = compRows[0];
      compData = {
        compname: Array.isArray(row) ? row[0] : row?.compname,
        comppct_r: Array.isArray(row) ? row[1] : row?.comppct_r,
        hydgrp: Array.isArray(row) ? row[2] : row?.hydgrp,
        drainagecl: Array.isArray(row) ? row[3] : row?.drainagecl
      };
    }

    // Parse horizon data for clay
    let clayPercent: number | null = null;
    if (horizonRows && horizonRows.length > 0) {
      const clayValue = Array.isArray(horizonRows[0]) ? horizonRows[0][0] : horizonRows[0]?.claytotal_r;
      clayPercent = clayValue ? Number(clayValue) : null;
    }

    return {
      compname: compData.compname,
      hydrologicGroup: compData.hydgrp,
      drainageClass: compData.drainagecl,
      restrictiveDepthCm: null, // Not available from basic queries
      clayPercent
    };
  } catch (primaryError) {
    // Fallback: Try NRCS Web Soil Survey
    try {
      return await fetchNRCSSoilData(point);
    } catch (fallbackError) {
      // If all fail, return empty soil data
      console.warn(
        "Soil data unavailable - primary:",
        primaryError instanceof Error ? primaryError.message : String(primaryError),
        "fallback:",
        fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
      );
      return {
        compname: undefined,
        hydrologicGroup: undefined,
        drainageClass: undefined,
        restrictiveDepthCm: null,
        clayPercent: null
      };
    }
  }
}

export type ElevationSample = {
  elevationMeters?: number | null;
};

export type ElevationSummary = {
  elevationMeters?: number | null;
  reliefMeters?: number | null;
  slopePercent?: number | null;
};

async function fetchEPQSElevation(point: GeoPoint, retryCount = 0): Promise<ElevationSample> {
  const maxRetries = 2;
  try {
    const url = `https://epqs.nationalmap.gov/v1/json?x=${point.lon}&y=${point.lat}&units=Meters&wkid=4326&includeDate=false`;
    const data = await fetchJson<any>(url, undefined, 8000);
    return { elevationMeters: typeof data?.value === "number" ? data.value : null };
  } catch (err) {
    if (retryCount < maxRetries) {
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 500));
      return fetchEPQSElevation(point, retryCount + 1);
    }

    // Fallback: Try USGS 3DEP service
    try {
      const url = `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/identify?geometry=${JSON.stringify({ x: point.lon, y: point.lat })}&geometryType=esriGeometryPoint&returnGeometry=false&f=json`;
      const data = await fetchJson<any>(url, undefined, 8000);
      const value = data?.value;
      return { elevationMeters: typeof value === "number" ? value : null };
    } catch {
      return { elevationMeters: null };
    }
  }
}

export async function fetchElevationSummary(point: GeoPoint, delta = 0.001): Promise<ElevationSummary> {
  try {
    const offsets = [
      { lat: point.lat + delta, lon: point.lon },
      { lat: point.lat - delta, lon: point.lon },
      { lat: point.lat, lon: point.lon + delta },
      { lat: point.lat, lon: point.lon - delta }
    ];

    const center = await fetchEPQSElevation(point);
    const samples = await Promise.all(offsets.map((p) => fetchEPQSElevation(p)));
    const values = [center.elevationMeters, ...samples.map((s) => s.elevationMeters)].filter(
      (v): v is number => typeof v === "number"
    );

    if (!values.length) {
      return { elevationMeters: null, reliefMeters: null, slopePercent: null };
    }

    const max = Math.max(...values);
    const min = Math.min(...values);
    const relief = max - min;
    const distance = 2 * delta * 111_320; // meters between north/south samples
    const slopePercent = distance > 0 ? (relief / distance) * 100 : null;

    return {
      elevationMeters: center.elevationMeters ?? null,
      reliefMeters: relief,
      slopePercent
    };
  } catch (err) {
    console.warn("Elevation fetch failed:", err instanceof Error ? err.message : String(err));
    return { elevationMeters: null, reliefMeters: null, slopePercent: null };
  }
}

// Estimate fire hazard risk based on location and wildfire data
export async function fetchFireHazard(point: GeoPoint): Promise<FireHazardData> {
  try {
    // Use USGS Wildland Fire Science data - check if location is in fire-prone region
    const url = `https://wildfire.usgs.gov/arcgis/rest/services/firehabitat/fc_fuels_hazard/MapServer/0/query?geometry=${point.lon},${point.lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&f=json`;

    try {
      const data = await fetchJson<any>(url, undefined, 8000);
      const feature = data?.features?.[0];

      if (feature?.attributes) {
        const hazardLevel = feature.attributes?.hazard_level?.toLowerCase();
        let wildfireRisk: "low" | "medium" | "high" | "very high" = "low";

        if (hazardLevel?.includes("very high") || hazardLevel?.includes("extreme")) {
          wildfireRisk = "very high";
        } else if (hazardLevel?.includes("high")) {
          wildfireRisk = "high";
        } else if (hazardLevel?.includes("moderate")) {
          wildfireRisk = "medium";
        }

        return {
          wildfireRisk,
          fireZoneCategory: feature.attributes?.zone_name ?? undefined,
          fireOccurrenceHistoryYears: undefined
        };
      }
    } catch {
      // Fallback: continue to next check
    }

    // Fallback: Use state-based fire risk assessment
    // Estimate risk based on latitude (generally higher risk in western states at certain elevations)
    const state = getStateFromCoordinates(point.lat, point.lon);
    const riskLevel = getStateFireRisk(state, point.lat);

    return {
      wildfireRisk: riskLevel,
      fireZoneCategory: `${state} (estimated)`,
      fireOccurrenceHistoryYears: undefined
    };
  } catch (err) {
    console.warn("Fire hazard fetch failed:", err instanceof Error ? err.message : String(err));
    return {
      wildfireRisk: "low",
      fireZoneCategory: undefined,
      fireOccurrenceHistoryYears: undefined
    };
  }
}

export async function fetchClimateNormals(point: GeoPoint): Promise<ClimateData> {
  try {
    const now = new Date();
    const endYear = now.getUTCFullYear() - 1;
    const startYear = endYear - 19;
    const startDate = `${startYear}-01-01`;
    const endDate = `${endYear}-12-31`;

    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${point.lat}&longitude=${point.lon}&start_date=${startDate}&end_date=${endDate}&daily=wind_speed_10m_max,snowfall_sum&wind_speed_unit=mph&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=UTC`;
    const data = await fetchJson<any>(url, undefined, 10000);

    const windSeries = Array.isArray(data?.daily?.wind_speed_10m_max)
      ? data.daily.wind_speed_10m_max
      : [];

    const snowSeries = Array.isArray(data?.daily?.snowfall_sum)
      ? data.daily.snowfall_sum
      : [];

    const dates = Array.isArray(data?.daily?.time) ? data.daily.time : [];

    const yearlyWindMax = new Map<number, number>();
    const yearlySnowSum = new Map<number, number>();

    const n = Math.min(dates.length, windSeries.length, snowSeries.length);
    for (let i = 0; i < n; i++) {
      const year = Number(String(dates[i]).slice(0, 4));
      if (!Number.isFinite(year)) continue;

      const wind = typeof windSeries[i] === "number" ? windSeries[i] : null;
      const snow = typeof snowSeries[i] === "number" ? snowSeries[i] : null;

      const existingWind = yearlyWindMax.get(year);
      if (typeof wind === "number" && (existingWind == null || wind > existingWind)) {
        yearlyWindMax.set(year, wind);
      }

      if (typeof snow === "number") {
        yearlySnowSum.set(year, (yearlySnowSum.get(year) ?? 0) + snow);
      }
    }

    const annualWindMaxValues = Array.from(yearlyWindMax.values()).sort((a, b) => a - b);
    const annualSnowCmValues = Array.from(yearlySnowSum.values())
      .map((inches) => inches * 2.54)
      .sort((a, b) => a - b);

    const pIndex = (arr: number[], p: number) => {
      if (!arr.length) return -1;
      return Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * p)));
    };

    const windP90Idx = pIndex(annualWindMaxValues, 0.9);
    const designWindMph = windP90Idx >= 0 ? annualWindMaxValues[windP90Idx] : null;

    const snowP90Idx = pIndex(annualSnowCmValues, 0.9);
    const snowP50Idx = pIndex(annualSnowCmValues, 0.5);
    const p90AnnualSnowCm = snowP90Idx >= 0 ? annualSnowCmValues[snowP90Idx] : null;
    const p50AnnualSnowCm = snowP50Idx >= 0 ? annualSnowCmValues[snowP50Idx] : null;
    const annualSnowCm =
      annualSnowCmValues.length > 0
        ? annualSnowCmValues.reduce((sum, value) => sum + value, 0) / annualSnowCmValues.length
        : null;

    return {
      designWindMph,
      annualSnowCm,
      p90AnnualSnowCm,
      p50AnnualSnowCm,
      analysisYears: annualSnowCmValues.length || annualWindMaxValues.length || null,
      source: `Open-Meteo archive ${startYear}-${endYear} (annualized)`
    };
  } catch {
    return {
      designWindMph: null,
      annualSnowCm: null,
      p90AnnualSnowCm: null,
      p50AnnualSnowCm: null,
      analysisYears: null,
      source: undefined
    };
  }
}

// Simple state lookup from coordinates
function getStateFromCoordinates(lat: number, lon: number): string {
  // Rough approximations for common states
  if (lon < -124 && lon > -117 && lat < 42 && lat > 32) return "CA"; // California
  if (lon < -105 && lon > -109 && lat < 41 && lat > 37) return "CO"; // Colorado
  if (lon < -120 && lon > -116 && lat < 49 && lat > 42) return "OR"; // Oregon
  if (lon < -119 && lon > -114 && lat < 43 && lat > 41) return "ID"; // Idaho
  if (lon < -109 && lon > -103 && lat < 37 && lat > 31) return "NM"; // New Mexico
  if (lon < -100 && lon > -94 && lat < 31 && lat > 25) return "TX"; // Texas
  if (lon < -95 && lon > -80 && lat < 40 && lat > 24) return "FL"; // Florida
  // Default to Midwest (lower fire risk)
  return "US";
}

// Estimate state-level fire risk
function getStateFireRisk(state: string, latitude: number): "low" | "medium" | "high" | "very high" {
  const highRiskStates: Record<string, "medium" | "high" | "very high"> = {
    CA: "very high",
    WA: "high",
    OR: "high",
    ID: "high",
    MT: "high",
    NM: "high",
    AZ: "high",
    CO: "medium",
    UT: "medium",
    NV: "medium",
    TX: "medium", // parts of TX have high risk
    FL: "medium"   // especially southern FL has wildfire risk
  };

  return highRiskStates[state] ?? "low";
}
