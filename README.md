# Homebase

Raspberry Pi based home monitoring dashboard

## Setup

### `./.env`

```bash
USERNAME=...
PASSWORD=...
METER_ID=...
INFLUX_ORG=ulrichlehner
INFLUX_BUCKET=smartmeter
INFLUX_TOKEN=<genereate a secure token string>
TIMEZONE=Europe/Vienna
DOCKER_INFLUXDB_INIT_USERNAME=admin
DOCKER_INFLUXDB_INIT_PASSWORD=<generate a secure password>
DOCKER_INFLUXDB_INIT_ORG=ulrichlehner
DOCKER_INFLUXDB_INIT_BUCKET=smartmeter
DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=<genereate a secure token string>
```

The variables `INFLUX_BUCKET` and `DOCKER_INFLUXDB_INIT_BUCKET` must have the same value, as well as `INFLUX_TOKEN` = `DOCKER_INFLUXDB_INIT_ADMIN_TOKEN` and `INFLUX_ORG` = `DOCKER_INFLUXDB_INIT_ORG`.

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
