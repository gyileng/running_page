# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`running_page` has two halves that meet at a single file:

1. **Python data pipeline** (`run_page/`) — pulls activities from ~20 fitness services, normalizes them into a SQLite DB, and emits `src/static/activities.json`.
2. **React/Vite frontend** (`src/`) — reads that JSON and renders it through a pluggable theme.

`src/static/activities.json` is the only contract between them. A Textual TUI (`run_page/tui/`) is a third consumer of the same JSON.

## Commands

Frontend (pnpm, node >= 20):

```bash
pnpm install          # corepack enable first if pnpm is missing
pnpm develop          # vite dev server on :5173
pnpm build            # -> dist/ (honors PATH_PREFIX for sub-path deploys)
pnpm lint             # eslint src --fix
pnpm check            # prettier --check (CI runs this; `pnpm format` writes)
```

Python (>= 3.12 per `pyproject.toml`; the sync workflow still pins 3.11):

```bash
pip install -r requirements.txt        # or: uv sync
make test                              # uv run python -m unittest discover -s . -p 'test_*.py'
make tui                               # uv run run_page  (Textual TUI over activities.json)
```

Single test:

```bash
uv run python -m unittest test_tui_app.RunningTUITest.test_monthly_distances_aggregates_by_month
```

`make ci` = test + lint + check + build. Python CI additionally runs `black . --check` and `ruff check .` — these are not wired into the Makefile, so run them manually before pushing Python changes.

Data sync (always from the repo root, never from inside `run_page/`):

```bash
python run_page/garmin_sync.py "<secret_string>"
python run_page/gpx_sync.py                       # no account: just ingest GPX_OUT/
python run_page/gen_svg.py --from-db --type github --output assets/github.svg
pnpm run data:clean                               # wipe db + *_OUT + activities.json
```

## Data pipeline architecture

Every `run_page/*_sync.py` is a standalone CLI script following the same shape:

1. Authenticate against the vendor, download new activity files into `GPX_OUT/`, `TCX_OUT/`, or `FIT_OUT/` (paths come from `run_page/config.py`), skipping ids already on disk.
2. Call `make_activities_file(SQL_FILE, folder, JSON_FILE, file_suffix=..., activity_title_dict=...)` from `run_page/utils.py`.

`make_activities_file` drives `run_page/generator/` — `Generator.sync_from_data_dir()` parses tracks via `gpxtrackposter/track_loader.py`, upserts rows into `run_page/data.db` (SQLAlchemy model in `generator/db.py`), then dumps the whole table to `src/static/activities.json`. Adding a new provider means writing a new `*_sync.py` that ends in this call; do not reimplement DB or JSON writing.

Import convention: sync scripts use flat imports (`from config import ...`, `from utils import ...`, `from generator import Generator`) that only resolve because the script's own directory lands on `sys.path` when invoked as `python run_page/foo.py`. Keep that style — switching to package-relative imports breaks the documented invocation and the GitHub Actions workflow. (`run_page/tui/` is the exception: it *is* a package, entry point `run_page.tui.app:main`, and uses relative imports. `src/run_page` is a symlink back to `run_page/`.)

`run_page/gpxtrackposter/` is a vendored/adapted poster generator; `gen_svg.py` selects a drawer (`grid`, `circular`, `github`, `monthoflife`, `year_summary`) and writes SVGs into `assets/`, which the classic theme's `SVGStat` component imports.

Environment knobs read by the pipeline (set in `.github/workflows/run_data_sync.yml`): `RUN_TYPE` selects which sync step runs, plus `IGNORE_BEFORE_SAVING`, `IGNORE_POLYLINE`/`IGNORE_RANGE` (privacy trimming via `polyline_processor.py`), `INDOOR_SPREAD_THRESHOLD`, `SAVE_DATA_IN_GITHUB_CACHE`.

## Frontend architecture

**Theme system** (see `docs/theme-system.md`): `src/App.tsx` holds a registry mapping a theme name to a lazily imported component under `src/themes/<name>/`. `config.yml`'s `theme_preset` picks one at build time (`dashboard` = single-page widget layout, `classic` = the v2.x multi-route layout using `react-router-dom` + `react-map-gl`). A new theme = a folder with a default-exporting `index.tsx` + one line in the registry; nothing else should need to change.

**Core layer**: shared logic lives in `src/core/` (`config.ts`, `i18n.ts`, `types.ts`, `hooks/`). `src/config.ts` and `src/hooks/*` are thin re-export bridges kept for backward compatibility — add new shared code to `src/core/` and let the bridge re-export it. `src/components/` holds the dashboard theme's widgets, reusable from other themes.

**Config**: `config.yml` at the repo root is imported directly by `src/core/config.ts` via the `@config` alias, parsed at build time by `@modyfi/vite-plugin-yaml`. It carries `mapbox_token`, `avatar`, `locale`, `theme`, `theme_preset`, and per-sport `goals`. Mapbox token resolution order: `VITE_MAPBOX_TOKEN` env (GitHub Actions secret `MAPBOX_TOKEN`) → `config.yml` → empty string. Never commit a real token.

**Data loading**: `getActivityData()` in `src/core/hooks/useActivities.ts` fetches `activities.json` by URL and implements Suspense by throwing the in-flight promise (and caching the result module-level). Call it inside a `<Suspense>` boundary; `resetActivityData()` exists so `ErrorBoundary` can retry.

Activity fields carry raw pipeline units — `distance` in meters, `average_speed` in m/s, `moving_time` as an `"H:MM:SS"` string — so use the `formatDistance`/`formatPace`/`formatDuration`/`parseMovingTime` helpers rather than converting inline. `location_country` arrives in three different shapes (Python dict repr, plain string, …); `extractProvince()` is the canonical parser for it.

**Vite specifics**: aliases `@` → `src/`, `@core`, `@themes`, `@assets`, `@config`. `vite-plugin-svgr` is configured with a custom SVGO plugin that rewrites hardcoded poster colors (`#1a1a1a`, `#4dd2ff`, …) into CSS classes so generated SVGs follow the dark/light theme. `PATH_PREFIX` sets `base` for GitHub Pages sub-path deploys.

## Deployment

`.github/workflows/run_data_sync.yml` runs the pipeline on a daily cron, commits the refreshed data back, and optionally triggers `gh-pages.yml` (which builds with `PATH_PREFIX=/$REPO_NAME`). The `Dockerfile` bundles sync + build for self-hosting via `--build-arg app=<Garmin|Strava|NRC|Keep|...>`.
