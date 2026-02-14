import { NextRequest, NextResponse } from "next/server";
import {
  fetchFEMAFloodZone,
  fetchElevationSummary,
  fetchSoils,
  fetchUSGSDesignMap,
  geocodeAddress,
  fetchFireHazard
} from "../../../lib/sources";
import { buildImplications, buildSignals } from "../../../lib/signals";
import { AnalysisResult, Fact } from "../../../lib/types";

export const dynamic = "force-dynamic";

function addFact(facts: Fact[], fact: Fact) {
  if (fact.value == null || fact.value === "") return;
  facts.push(fact);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const address = body?.address?.trim();
    if (!address) {
      return NextResponse.json({ error: "Address required" }, { status: 400 });
    }

    const warnings: string[] = [];
    const facts: Fact[] = [];

    const geocode = await geocodeAddress(address);
    addFact(facts, {
      source: "US Census Geocoder",
      label: "Matched Address",
      value: geocode.matchedAddress ?? address
    });
    addFact(facts, {
      source: "US Census Geocoder",
      label: "Latitude",
      value: geocode.location.lat
    });
    addFact(facts, {
      source: "US Census Geocoder",
      label: "Longitude",
      value: geocode.location.lon
    });

    const [usgs, fema, soils, elevation, fire] = await Promise.all([
      fetchUSGSDesignMap(geocode.location).catch((err) => {
        warnings.push(`USGS design maps unavailable: ${err.message}`);
        return undefined;
      }),
      fetchFEMAFloodZone(geocode.location).catch((err) => {
        warnings.push(`FEMA flood data unavailable: ${err.message}`);
        return undefined;
      }),
      fetchSoils(geocode.location).catch((err) => {
        warnings.push(`USDA soils unavailable: ${err.message}`);
        return undefined;
      }),
      fetchElevationSummary(geocode.location).catch((err) => {
        warnings.push(`USGS elevation unavailable: ${err.message}`);
        return undefined;
      }),
      fetchFireHazard(geocode.location).catch((err) => {
        warnings.push(`Fire hazard data unavailable: ${err.message}`);
        return undefined;
      })
    ]);

    if (usgs) {
      addFact(facts, { source: "USGS Design Maps", label: "SDS", value: usgs.sds ?? null, unit: "g" });
      addFact(facts, { source: "USGS Design Maps", label: "SD1", value: usgs.sd1 ?? null, unit: "g" });
      addFact(facts, { source: "USGS Design Maps", label: "PGA", value: usgs.pga ?? null, unit: "g" });
      addFact(facts, { source: "USGS Design Maps", label: "SDC", value: usgs.sdc ?? null });
    }

    if (fema) {
      addFact(facts, { source: "FEMA NFHL", label: "Flood Zone", value: fema.floodZone ?? null });
      addFact(facts, { source: "FEMA NFHL", label: "Zone Subtype", value: fema.zoneSubtype ?? null });
      addFact(facts, { source: "FEMA NFHL", label: "Base Flood Elevation", value: fema.staticBfe ?? null, unit: "ft" });
    }

    if (soils) {
      addFact(facts, { source: "USDA NRCS SSURGO", label: "Soil Component", value: soils.compname ?? null });
      addFact(facts, { source: "USDA NRCS SSURGO", label: "Drainage Class", value: soils.drainageClass ?? null });
      addFact(facts, { source: "USDA NRCS SSURGO", label: "Hydrologic Group", value: soils.hydrologicGroup ?? null });
      addFact(facts, {
        source: "USDA NRCS SSURGO",
        label: "Restrictive Depth",
        value: soils.restrictiveDepthCm ?? null,
        unit: "cm"
      });
      addFact(facts, {
        source: "USDA NRCS SSURGO",
        label: "Surface Clay",
        value: soils.clayPercent ?? null,
        unit: "%"
      });
    }

    if (elevation) {
      addFact(facts, {
        source: "USGS EPQS",
        label: "Elevation",
        value: elevation.elevationMeters ?? null,
        unit: "m"
      });
      addFact(facts, {
        source: "USGS EPQS",
        label: "Local Relief",
        value: elevation.reliefMeters ?? null,
        unit: "m"
      });
      addFact(facts, {
        source: "USGS EPQS",
        label: "Approx Slope",
        value: elevation.slopePercent ?? null,
        unit: "%"
      });
    }

    if (fire) {
      addFact(facts, {
        source: "USGS Wildland Fire",
        label: "Wildfire Risk",
        value: fire.wildfireRisk ?? null
      });
      addFact(facts, {
        source: "USGS Wildland Fire",
        label: "Fire Zone Category",
        value: fire.fireZoneCategory ?? null
      });
    }

    const signals = buildSignals({ fema, usgs, soils, elevation, fire });
    const implications = buildImplications(signals);

    const result: AnalysisResult = {
      address,
      location: geocode.location,
      facts,
      signals,
      implications,
      warnings
    };

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Unknown error" }, { status: 500 });
  }
}
