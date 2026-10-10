GET {{HOST}}/{{IYFCONFIG}}/manifest.json
HTTP 200

GET {{HOST}}/{{IYFCONFIG}}/catalog/series/iyf.series.TVSeries.json
HTTP 200

GET {{HOST}}/{{IYFCONFIG}}/catalog/movie/iyf.movie.Korean.json
HTTP 200

GET {{HOST}}/{{IYFCONFIG}}/catalog/series/iyf.series.Popular.json
HTTP 200

# Meta and stream route on the iyf: prefixed ids the catalog rows carry
GET {{HOST}}/{{IYFCONFIG}}/meta/series/iyf:thAxXxmZ8A7.json
HTTP 200

GET {{HOST}}/{{IYFCONFIG}}/stream/series/iyf:thAxXxmZ8A7:1:1.json
HTTP 200

GET {{HOST}}/{{IYFCONFIG}}/subtitles/series/iyf:thAxXxmZ8A7:1:1.json
HTTP 200
