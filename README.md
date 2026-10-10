# TourScout

TourScout plans a short run of shows for an independent band. You type the artist, where the van starts, how many dates you have and how long you're willing to drive. It returns a routed tour: which cities, which room to pitch in each one, which local act to ask to open, and a promo angle for each night.

Picking cities is the hard part of booking a small tour. Most bands go by gut feel or by last tour's ticket counts, so they keep playing the same big cities and skip smaller places where their kind of listener actually lives. TourScout uses the Qloo Taste AI API to find those places.

## How it works

An agent built on Claude works through six tools. Five of them call Qloo.

| Step | Tool | Qloo call |
|---|---|---|
| Find the artist | `lookup_artist` | `/search` (artists) |
| Who the fans are | `fan_profile` | `/v2/insights` with `filter.type=urn:demographics` |
| Where taste matches | `scan_region` | `/v2/insights` with `filter.type=urn:heatmap` inside the region polygon. Cells are rolled up to the nearest metro and ranked. |
| Check a city | `scout_city` | `/v2/insights` for venues (`urn:entity:place` + music-venue tag), similar artists in that city (openers), and local brands, places and podcasts (promo partners) |
| Check the drive | `check_route` | none. Distance and drive time come from a local GeoNames city table. |
| Hand in the plan | `submit_plan` | none. The server orders the stops and recomputes drive times so the numbers can't be made up. |

The agent compares taste rank with city size. A city that ranks higher for taste than its size would predict is a good bet for a small band, because the fans are there and the competition for attention is lower. Then it trades that off against drive time and the cities you've already played.

Every Qloo request is logged and shown on the page, so you can see which call produced each pick.

### Model alone

Next to the plan, the same model picks cities for the same band without any Qloo access. Both lists are scored on the same Qloo heatmap. Without taste data the model falls back on big, well-known music cities. The gap between the two lists is the reason Qloo is in this project.

## Run it

```bash
npm install
cp .env.example .env.local   # add your keys
npm run dev
```

| Variable | Needed | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Claude API key |
| `QLOO_API_KEY` | for real data | Without it the app runs on clearly labelled placeholder data |
| `QLOO_BASE_URL` | no | Defaults to `https://hackathon.api.qloo.com` |
| `TOURSCOUT_MODEL` | no | Defaults to `claude-opus-5-5` |
| `RUNS_PER_HOUR` | no | Per-IP limit on agent runs, default 6 |

## Stack

Next.js 15 (App Router), React 19, Tailwind CSS 4, Leaflet, the Anthropic TypeScript SDK, and zod. Map tiles come from Esri's light gray canvas. City data is from GeoNames (`cities15000`, CC BY 4.0).

## Limits

- Drive times are straight-line distance × 1.25 at 85 km/h. Check a real map before you book.
- Qloo tells you where the audience's taste is. It doesn't tell you which room has an open date or what it pays. The plan is a shortlist to pitch, not a confirmed booking.

## License

MIT
