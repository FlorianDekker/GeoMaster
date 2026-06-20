# 🌍 GeoMaster

A fast, friendly geography quiz. Test how much of the world you know with flags, country names and an interactive world map.

**Play it live:** https://floriandekker.github.io/GeoMaster/

## Modes

- **Choice** — pick the right country for a flag (4 options).
- **Type** — type the country name from its flag (accepts common aliases, e.g. *USA*, *UK*, *Holland*).
- **Map** — a country lights up on the world map; name it.

Filter by region (Europe, Asia, Africa, North/South America, Oceania), keep a streak alive, beat the clock (20s per question) and survive on 3 lives. Missed countries are listed at the end so you can learn them.

## Tech

Plain HTML/CSS/JavaScript — **no build step, no dependencies.**

- Country borders: [Natural Earth](https://www.naturalearthdata.com/) 110m (`world.geojson`), rendered with a simple equirectangular projection.
- Flags: [flagcdn.com](https://flagcdn.com/).
- Fonts: Fredoka + Nunito (Google Fonts).

## Run locally

The app `fetch()`es `world.geojson`, so it needs to be served over HTTP (opening `index.html` directly via `file://` is blocked by the browser). Any static server works, e.g.:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Deploy (GitHub Pages)

Settings → Pages → Source: **Deploy from a branch** → Branch: `main` / `root`. The site goes live at the URL above.

## License

MIT — see [LICENSE](LICENSE).
