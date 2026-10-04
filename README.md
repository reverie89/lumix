<p align="center">
  <img alt="lumix logo" width=256 height=256 src="public/img/lumix.ico"></img>
</p>

# lumix

A stremio addon to stream dramas, series and movies. Enriched with
[TMDB](https://themoviedb.org) artwork and descriptions (set `TMDB_API_KEY` in
the env file; without it the providers' own data is used).

# How to use

The default config serves the providers' catalogs and streams; the config
page's provider list removes or reorders them. The config
page opens in English — pick 中文
at the top to use it (and your Stremio catalogs) in Chinese.

## Directly from the website

1. Visit your deployment's landing page (a local server serves it at
   [http://localhost:55913](http://localhost:55913)).
2. Configure mirrors and Explore categories.
3. Install with your preferred method.

# Self-host / Development

## Self-host

To run this addon you can run the stable version (latest) with the docker-compose.yaml file provided:

```yaml
services:
  lumix:
    image: ghcr.io/reverie89/lumix:latest
    container_name: lumix
    ports:
      - 55913:55913
    environment: # more info in .env.example
      # Provider sources — the addon runs without them, but end users get nothing
      # to watch until these hold working values
      ## kisskh mirrors served to the config page and used when a config carries no mirrors (comma-separated http(s) URLs, tried in order) | none
      - KISSKH_MIRRORS=
      ## 欧乐 API hosts served to the config page (comma-separated http(s) URLs) | none
      - OLE_HOSTS=

      ## The Movie Database (TMDB) Read Only Access Token. Enriches catalogs and
      ## metas with artwork/descriptions; leave empty to skip the TMDB feature
      - TMDB_API_KEY=

      # Addon configuration
      ## Min title matching score (higher mean only very similar title matches, 0 - 100) | 75
      - MIN_MATCHING_SCORE=
      ## Match ignore words | ["uncut", "uncut version", "uncut ver."]
      - MATCH_IGNORES=

      # Server configuration
      ## Rate-limit keys from x-forwarded-for/cf-connecting-ip (true); false uses the socket address | true
      - TRUST_PROXY=
      ## Warm the default catalogs on startup | true
      - WARM_CACHE=
      ## Maximum timeout in milliseconds | 7000
      - RETRY_TIMEOUT_MS=
      ## Delay in milliseconds between retries with exponential backoff | 5000
      - RETRY_DELAY_MS=
      ## Retry jitter | 500
      - RETRY_JITTER_MS=

      # Rate limit
      ## Catalog window minutes / request limit | 10 / 20
      - CATALOG_WINDOW_MINUTES=
      - CATALOG_REQUEST_LIMIT=
      ## Meta window minutes / request limit | 10 / 20
      - META_WINDOW_MINUTES=
      - META_REQUEST_LIMIT=
      ## Stream window minutes / request limit | 10 / 10
      - STREAM_WINDOW_MINUTES=
      - STREAM_REQUEST_LIMIT=
      ## Subtitles window minutes / request limit | 10 / 10
      - SUBTITLES_WINDOW_MINUTES=
      - SUBTITLES_REQUEST_LIMIT=
      ## Subtitle VTT proxy request limit in the subtitles window (every track fetch counts) | 60
      - SUBTITLES_PROXY_REQUEST_LIMIT=

      # Outbound proxy
      ## Mediaflow-style proxy wrapper. Used for TMDB when PROXY_TMDB is on and for kisskh subtitles when PROXY_KISSKH_SUBTITLE is on | ""
      - PROXY_URL=
      ## Proxy wrapper port | 443
      - PROXY_PORT=
      ## Route TMDB requests through the proxy wrapper | false
      - PROXY_TMDB=
      ## Route kisskh subtitle requests through the proxy wrapper | false
      - PROXY_KISSKH_SUBTITLE=
      ## Webshare rotating proxy for kisskh requests | ""
      - PROXY_WEBSHARE_URL=
      ## Webshare proxy port | 80
      - PROXY_WEBSHARE_PORT=
      - PROXY_WEBSHARE_USERNAME=
      - PROXY_WEBSHARE_PASSWORD=

      # Boolean flags accept true/false/1/0; leaving a var empty applies the default shown after "|"
    volumes:
      - data:/app/data # persists ./data/lumix.db
    restart: unless-stopped
volumes:
  data:
```

Or with docker run:

```sh
docker run -d \
  --name lumix \
  -p 55913:55913 \
  --env-file .env \
  --volume ./data:/app/data \
  --restart unless-stopped \
  ghcr.io/reverie89/lumix:latest
```

Every env var is optional; `TMDB_API_KEY` enables TMDB artwork/description
enrichment and can be left empty.
The other values are optional with the default value written after | e.g. default `MIN_MATCHING_SCORE` is 75.
The server always listens on port 55913; the database lives at `./data/lumix.db`
(volume-mount `/app/data` in Docker to persist it).
Example [env file](.env.example)

## Development

### Start the source

Install the dependencies

```sh
npm install
```

Start the development server (no hot reload)

```sh
npm run dev
```

Build to deploy as a standalone server

```sh
npm run build
```

Run the standalone server

```sh
npm start
```
