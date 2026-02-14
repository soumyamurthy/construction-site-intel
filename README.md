# Construction Site Intelligence POC

A modern web application that analyzes construction sites by aggregating environmental, geotechnical, and climate data from authoritative US government sources. It synthesizes multi-source data into actionable risk and cost signals for construction professionals.

## Features

- **Multi-Source Data Integration**
  - 🌍 **Geocoding** - US Census Geocoder
  - 💧 **Flood Hazards** - FEMA National Flood Hazard Layer
  - ⚡ **Seismic Design** - USGS Earthquake Hazards Maps
  - 🏔️ **Soil Analysis** - USDA NRCS SSURGO Database
  - 🗻 **Elevation & Terrain** - USGS EPQS 3DEP
  - 🔥 **Wildfire Risk** - USGS Wildland Fire Science

- **Intelligent Signal Generation**
  - Risk categorization (High/Medium/Low severity)
  - Organized by domain (Flood, Seismic, Soils, Terrain, Environmental)
  - Dynamic cost and risk implications
  - Detailed explanations for each signal

- **Production-Ready UI**
  - Modern glassmorphic design with backdrop blur
  - Responsive grid layout
  - Smooth animations and hover states
  - Severity color coding
  - Mobile-optimized interface

- **Reliability Features**
  - Automatic retry logic with exponential backoff
  - Multiple data source fallbacks
  - Graceful error handling
  - Optional field handling for partial data

## Data Sources

All data sources are:
- ✓ **Free & Public** - No API keys required
- ✓ **Authoritative** - Official US government agencies
- ✓ **Real-time** - Current data feeds
- ✓ **Comprehensive** - Nationwide coverage (US only)

## Getting Started

### Prerequisites
- Node.js 18+ (recommended: Node 20+)
- npm or yarn

### Installation

```bash
# Clone the repository
git clone <your-repo-url>

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## Usage

1. Enter a US address in the form
2. Click "Run Analysis"
3. View comprehensive site analysis with:
   - Summary of location details
   - Categorized risk signals
   - Cost and risk implications
   - Source attribution

### Test Addresses with Rich Data

For best results (most complete soil data):
- **300 E Lincoln Way, Ames, IA 50010** ⭐ (Iowa heartland - excellent soil coverage)
- **100 Main St, Gainesville, FL 32601** (Florida - good soil data)
- **1 University Ave, Urbana, IL 61801** (Illinois agricultural region)

## Tech Stack

- **Framework** - Next.js 14.2.5
- **Language** - TypeScript
- **Styling** - CSS with CSS variables
- **Runtime** - Node.js
- **Deployment** - Vercel (recommended)

## Building for Production

```bash
npm run build
npm start
```

The production bundle is optimized and ready for deployment.

## Deployment

### Deploy to Vercel (Recommended)

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-github-url>
   git push -u origin main
   ```

2. **Connect to Vercel**
   - Go to [vercel.com](https://vercel.com)
   - Click "New Project"
   - Select your GitHub repository
   - Vercel auto-detects Next.js settings
   - Click "Deploy"
   - Done! 🚀

3. **Your app is live** at `<your-project>.vercel.app`

### Environment Setup (if using custom .env)
Create `.env.local` for local development:
```
# No required env vars - all data sources are public
# Optional: Add monitoring/analytics tokens here
```

## API

### POST `/api/analyze`

Analyzes a construction site address.

**Request:**
```json
{
  "address": "300 E Lincoln Way, Ames, IA 50010"
}
```

**Response:**
```json
{
  "address": "300 E Lincoln Way, Ames, IA 50010",
  "location": {
    "lat": 42.0228,
    "lon": -93.6077
  },
  "facts": [
    {
      "source": "USDA NRCS SSURGO",
      "label": "Drainage Class",
      "value": "Well drained",
      "unit": null
    }
  ],
  "signals": [
    {
      "id": "flood-zone",
      "label": "Flood Hazard Zone",
      "value": "X",
      "severity": "low",
      "explanation": "..."
    }
  ],
  "implications": [
    {
      "title": "Baseline Controls",
      "detail": "No extreme signals detected..."
    }
  ],
  "warnings": []
}
```

## Architecture

```
app/
├── page.tsx              # Main UI component
├── api/analyze/route.ts  # Analysis API endpoint
└── globals.css          # Global styles

lib/
├── sources.ts           # External data fetchers
├── signals.ts           # Signal builder logic
└── types.ts             # TypeScript definitions
```

## Signal Categories

| Category | Icon | Signals | Severity Drivers |
|----------|------|---------|-----------------|
| Flood Hazards | 💧 | Flood Zone, Base Flood Elevation | High-risk zones (A, V) |
| Seismic | ⚡ | SDC, SDS, SD1 | High design categories (D-F) |
| Soils | 🏔️ | Drainage, Hydrologic Group, Clay, Depth | Poor drainage, high clay, shallow restrictive layers |
| Terrain | 🗻 | Local Slope | Steep slopes (>10%) |
| Environmental | 🔥 | Wildfire Risk | High/Very High fire zones |

## Performance

- **First Load**: ~88 KB (optimized Next.js)
- **API Response**: <5s (with retry logic)
- **Build Size**: Minimal (tree-shaken Next.js)

## Error Handling

The app gracefully handles:
- ❌ Failed geocoding → Shows error message
- ❌ Missing data sources → Returns available data
- ❌ API timeouts → Automatic retry with exponential backoff
- ❌ Invalid addresses → Clear error feedback

## Future Enhancements

- [ ] Historical flood data (past 50 years)
- [ ] Liquefaction potential mapping
- [ ] Boring log integration (premium data)
- [ ] Multi-site comparison
- [ ] Export to PDF
- [ ] Batch address processing
- [ ] Real estate market analysis overlay

## License

MIT

## Support & Contributing

- **Issues** - Report bugs on GitHub
- **Discussions** - Share feedback and ideas
- **PRs** - Contributions welcome!

## Sources & Attribution

- [USGS Earthquake Hazards](https://earthquake.usgs.gov)
- [FEMA National Flood Hazard Layer](https://www.fema.gov/flood-maps)
- [USDA NRCS Soils](https://www.nrcs.usda.gov/wps/portal/nrcs/detail/soils)
- [US Census Geocoder](https://geocoding.geo.census.gov)
- [USGS 3DEP Elevation](https://www.usgs.gov/3dep)
- [USGS Wildland Fire Science](https://wildfire.usgs.gov)

---

**Built with ❤️ for construction professionals**
