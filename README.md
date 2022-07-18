# Homebase

Raspberry Pi based home monitoring dashboard

## Setup

### `./databot/.env`

```bash
USERNAME=...
PASSWORD=...
METER_ID=...
```

## Run

`docker compose up --build`

## Migrate Data

`docker compose run --rm databot pipenv run python3 main.py --migrate`

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
