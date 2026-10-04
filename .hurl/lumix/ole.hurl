GET {{HOST}}/{{OLECONFIG}}/manifest.json
HTTP 200

GET {{HOST}}/{{OLECONFIG}}/catalog/series/ole.series.Korean.json
HTTP 200

GET {{HOST}}/{{OLECONFIG}}/catalog/movie/ole.movie.Korean.json
HTTP 200

# The TVSeries catalog feeds meta/stream; a series detail carries every
# episode's stream url upstream, so both resolve without a search
GET {{HOST}}/{{OLECONFIG}}/catalog/series/ole.series.TVSeries.json
HTTP 200

GET {{HOST}}/{{OLECONFIG}}/meta/series/ole:85005.json
HTTP 200

GET {{HOST}}/{{OLECONFIG}}/stream/series/ole:85005:1:1.json
HTTP 200

GET {{HOST}}/{{OLECONFIG}}/subtitles/series/ole:85005:1:1.json
HTTP 200
