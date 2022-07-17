# Homebase

Raspberry Pi based home monitoring dashboard

## Setup

### `./webscraper/.env`

```bash
USERNAME=...
PASSWORD=...
METER_ID=...
```

## Run

`docker compose up --build`

## Migrate Data

`docker compose run --rm webscraper pipenv run python3 main.py --migrate`

## Grafana

Query data with:

```
from(bucket: "smartmeter")
  |> range(start: v.timeRangeStart, stop:v.timeRangeStop)
  |> filter(fn: (r) =>
    r._measurement == "meteredValues" and
    r._field == "value"
  )
```
