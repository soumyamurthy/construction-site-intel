import { GeoPoint } from "./types";

const DEFAULT_TIMEOUT_MS = 12000;
const FEMA_FLOOD_ZONE_LAYER_URL =
  "https://hazards.fema.gov/arcgis/rest/services/FIRMette/NFHLREST_FIRMette/MapServer/20/query";
const NOAA_SPC_MAPSERVER_URL =
  "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer";

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
  source?: string;
};

export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const normalized = address
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
  const parts = normalized.split(",").map((part) => part.trim()).filter(Boolean);
  const lastPart = parts[parts.length - 1] ?? "";
  const lastMatch = lastPart.match(/^([A-Za-z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/);
  const state = lastMatch?.[1]?.toUpperCase();
  const zip = lastMatch?.[2];
  const city = parts.length >= 2 ? parts[parts.length - 2] : undefined;

  const candidates = new Set<string>();
  candidates.add(address.trim());
  candidates.add(normalized);
  candidates.add(normalized.replace(/^[A-Z]One\s/, "One "));
  candidates.add(normalized.replace(/(\b[A-Za-z]{2})\s+\d{5}(?:-\d{4})?$/, "$1").trim());

  if (city && state) {
    if (parts.length >= 3) {
      const street = parts.slice(0, -2).join(", ");
      candidates.add(`${street}, ${city}, ${state}`);
      if (zip) {
        candidates.add(`${street}, ${city}, ${state} ${zip}`);
      }
    }
    candidates.add(`${city}, ${state}`);
    if (zip) {
      candidates.add(`${city}, ${state} ${zip}`);
    }
  }

  const addressVariations = Array.from(candidates).filter(Boolean);

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
          location: { lat: match.coordinates.y, lon: match.coordinates.x },
          source: "US Census Geocoder"
        };
      }
    } catch (err) {
      // Try next variation
      continue;
    }
  }

  // Fallback 1: OpenStreetMap Nominatim (free, no API key)
  for (const addr of addressVariations) {
    try {
      const encoded = encodeURIComponent(addr);
      const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1`;
      const data = await fetchJson<any>(url, {
        headers: {
          "User-Agent": "construction-site-intel/1.0 (site-intelligence-app)",
          "Accept-Language": "en-US,en;q=0.9"
        }
      }, 9000);

      if (data && Array.isArray(data) && data.length > 0) {
        const match = data[0];
        return {
          matchedAddress: match.display_name || addr,
          location: {
            lat: parseFloat(match.lat),
            lon: parseFloat(match.lon)
          },
          source: "OpenStreetMap Nominatim"
        };
      }
    } catch (err) {
      continue;
    }
  }

  // Fallback 2: Open-Meteo geocoding (robust for city/state and many street-level queries)
  for (const addr of addressVariations) {
    try {
      const encoded = encodeURIComponent(addr);
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encoded}&count=1&language=en&format=json`;
      const data = await fetchJson<any>(url, undefined, 9000);
      const result = data?.results?.[0];
      if (result && Number.isFinite(result.latitude) && Number.isFinite(result.longitude)) {
        const labelParts = [result.name, result.admin1, result.country_code].filter(Boolean);
        return {
          matchedAddress: labelParts.length > 0 ? labelParts.join(", ") : addr,
          location: {
            lat: Number(result.latitude),
            lon: Number(result.longitude)
          },
          source: "Open-Meteo Geocoding"
        };
      }
    } catch (err) {
      continue;
    }
  }

  throw new Error(
    `Could not geocode address: "${address}". ` +
    `Please try a standard format like "123 Main St, City, ST 12345" or "City, ST".`
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
  sfhaNearby?: boolean;
  sfhaSearchRadiusKm?: number;
  source?: string;
};

export async function fetchFEMAFloodZone(point: GeoPoint): Promise<FEMAData> {
  const searchRadiusKm = 1.5;
  const latDelta = searchRadiusKm / 111.32;
  const lonDelta = searchRadiusKm / (111.32 * Math.max(0.2, Math.cos((point.lat * Math.PI) / 180)));
  try {
    const pointUrl =
      `${FEMA_FLOOD_ZONE_LAYER_URL}?geometry=${point.lon},${point.lat}` +
      "&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects" +
      "&outFields=FLD_ZONE,ZONE_SUBTY,STATIC_BFE,DFIRM_ID,SFHA_TF&returnGeometry=false&f=json";

    const pointData = await fetchJson<any>(pointUrl, undefined, 9000);
    const feature = pointData?.features?.[0]?.attributes;

    const envelope =
      `${point.lon - lonDelta},${point.lat - latDelta},${point.lon + lonDelta},${point.lat + latDelta}`;
    const nearbyUrl =
      `${FEMA_FLOOD_ZONE_LAYER_URL}?geometry=${envelope}` +
      "&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects" +
      "&where=" + encodeURIComponent("(FLD_ZONE LIKE 'A%' OR FLD_ZONE LIKE 'V%')") +
      "&returnCountOnly=true&f=json";

    const nearbyData = await fetchJson<any>(nearbyUrl, undefined, 9000);
    const sfhaNearby = Number(nearbyData?.count ?? 0) > 0;

    if (feature?.FLD_ZONE) {
      const rawBfe = feature?.STATIC_BFE;
      const staticBfe =
        typeof rawBfe === "number" && Number.isFinite(rawBfe) && rawBfe > -9998
          ? rawBfe
          : null;
      const baseSubtype = feature?.ZONE_SUBTY ?? undefined;
      const zoneSubtype =
        sfhaNearby && !String(feature.FLD_ZONE).startsWith("A") && !String(feature.FLD_ZONE).startsWith("V")
          ? `${baseSubtype ?? "Outside mapped areas"}; SFHA nearby within ~${searchRadiusKm} km`
          : baseSubtype;

      return {
        floodZone: feature.FLD_ZONE,
        zoneSubtype,
        staticBfe,
        firmPanel: feature?.DFIRM_ID ?? undefined,
        sfhaNearby,
        sfhaSearchRadiusKm: searchRadiusKm,
        source: "FEMA NFHL"
      };
    }

    return {
      floodZone: undefined,
      zoneSubtype: undefined,
      staticBfe: null,
      firmPanel: undefined,
      sfhaNearby,
      sfhaSearchRadiusKm: searchRadiusKm,
      source: "FEMA NFHL"
    };
  } catch (err) {
    // Return unknown values on source failure to avoid false "low" interpretations.
    return {
      floodZone: undefined,
      zoneSubtype: undefined,
      staticBfe: null,
      firmPanel: undefined,
      sfhaNearby: undefined,
      sfhaSearchRadiusKm: searchRadiusKm,
      source: "FEMA NFHL"
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

export type SevereWeatherData = {
  day1TornadoProbPct?: number | null;
  day2TornadoProbPct?: number | null;
  day1Significant?: boolean;
  day2Significant?: boolean;
  source?: string;
  day1Valid?: string;
  day2Valid?: string;
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
    const sql = `SELECT TOP 1 compname, hydgrp, drainagecl, resdept_r
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

    const restrictiveRaw = Array.isArray(row) ? row[3] : row?.resdept_r;
    const restrictiveDepthCm =
      restrictiveRaw != null && restrictiveRaw !== "" && Number.isFinite(Number(restrictiveRaw))
        ? Number(restrictiveRaw)
        : null;

    return {
      compname: Array.isArray(row) ? row[0] : row?.compname,
      hydrologicGroup: Array.isArray(row) ? row[1] : row?.hydgrp,
      drainageClass: Array.isArray(row) ? row[2] : row?.drainagecl,
      restrictiveDepthCm,
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

    // Step 2: Get component data (comppct_r, hydgrp, drainagecl, restrictive depth)
    const compSql =
      `SELECT TOP 1 compname, comppct_r, hydgrp, drainagecl, resdept_r ` +
      `FROM component WHERE mukey = '${mukey}' ORDER BY comppct_r DESC`;
    const compRows = await sdaQuery(compSql, 3);

    // Step 3: Get maximum clay content in shallow profile (top 100 cm).
    const horizonSql =
      `SELECT MAX(claytotal_r) AS max_clay ` +
      `FROM chorizon ch INNER JOIN component c ON c.cokey = ch.cokey ` +
      `WHERE c.mukey = '${mukey}' AND ch.hzdept_r <= 100`;
    const horizonRows = await sdaQuery(horizonSql, 2);

    // Parse component data (comes as array of [compname, comppct_r, hydgrp, drainagecl, resdept_r])
    let compData: any = {};
    if (compRows && compRows.length > 0) {
      const row = compRows[0];
      compData = {
        compname: Array.isArray(row) ? row[0] : row?.compname,
        comppct_r: Array.isArray(row) ? row[1] : row?.comppct_r,
        hydgrp: Array.isArray(row) ? row[2] : row?.hydgrp,
        drainagecl: Array.isArray(row) ? row[3] : row?.drainagecl,
        resdept_r: Array.isArray(row) ? row[4] : row?.resdept_r
      };
    }

    // Parse horizon data for clay
    let clayPercent: number | null = null;
    if (horizonRows && horizonRows.length > 0) {
      const clayValue = Array.isArray(horizonRows[0]) ? horizonRows[0][0] : horizonRows[0]?.max_clay;
      clayPercent = clayValue ? Number(clayValue) : null;
    }

    const restrictiveDepthRaw = compData.resdept_r;
    const restrictiveDepthCm =
      restrictiveDepthRaw != null && Number.isFinite(Number(restrictiveDepthRaw))
        ? Number(restrictiveDepthRaw)
        : null;

    return {
      compname: compData.compname,
      hydrologicGroup: compData.hydgrp,
      drainageClass: compData.drainagecl,
      restrictiveDepthCm,
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

async function fetchSpcOutlookMaxDn(layerId: number, point: GeoPoint): Promise<{ maxDn: number; valid?: string }> {
  const url =
    `${NOAA_SPC_MAPSERVER_URL}/${layerId}/query?geometry=${point.lon},${point.lat}` +
    "&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects" +
    "&outFields=dn,valid&returnGeometry=false&f=json";

  const data = await fetchJson<any>(url, undefined, 8000);
  const features = Array.isArray(data?.features) ? data.features : [];
  if (!features.length) {
    return { maxDn: 0, valid: undefined };
  }

  let maxDn = 0;
  let valid: string | undefined;
  for (const feature of features) {
    const attrs = feature?.attributes ?? {};
    const dn = Number(attrs?.dn);
    if (Number.isFinite(dn) && dn > maxDn) maxDn = dn;
    if (!valid && typeof attrs?.valid === "string") valid = attrs.valid;
  }

  return { maxDn, valid };
}

export async function fetchSPCTornadoOutlook(point: GeoPoint): Promise<SevereWeatherData> {
  try {
    const [day1Prob, day2Prob, day1Sig, day2Sig] = await Promise.all([
      fetchSpcOutlookMaxDn(3, point),
      fetchSpcOutlookMaxDn(11, point),
      fetchSpcOutlookMaxDn(2, point),
      fetchSpcOutlookMaxDn(10, point)
    ]);

    return {
      day1TornadoProbPct: day1Prob.maxDn,
      day2TornadoProbPct: day2Prob.maxDn,
      day1Significant: day1Sig.maxDn > 0,
      day2Significant: day2Sig.maxDn > 0,
      day1Valid: day1Prob.valid,
      day2Valid: day2Prob.valid,
      source: "NOAA SPC Convective Outlooks"
    };
  } catch (err) {
    throw new Error(`NOAA SPC tornado outlook unavailable: ${err instanceof Error ? err.message : String(err)}`);
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
