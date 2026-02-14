export type GeoPoint = {
  lat: number;
  lon: number;
};

export type Fact = {
  source: string;
  label: string;
  value: string | number | null;
  unit?: string;
  note?: string;
};

export type Signal = {
  id: string;
  label: string;
  value: string;
  severity: "low" | "medium" | "high" | "unknown";
  explanation: string;
};

export type Implication = {
  title: string;
  detail: string;
};

export type AnalysisResult = {
  address: string;
  location?: GeoPoint;
  facts: Fact[];
  signals: Signal[];
  implications: Implication[];
  warnings: string[];
};
