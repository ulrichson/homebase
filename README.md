# Homebase

Raspberry Pi based home monitoring dashboard

## Setup

### Raspberry Pi

1. Install `Raspberry Pi OS Lite (64-Bit)`
2. Install `Docker` (see [Install Docker Engine on Debian](https://docs.docker.com/engine/install/debian/#install-using-the-convenience-script) for latest instructions, at this time the _Install using the convenience script_ section must be used for Raspberry Pi):

   ```bash
   curl -fsSL https://get.docker.com -o get-docker.sh
   sudo sh get-docker.sh

   # Let the logged-in user use `docker` without `sudo`
   sudo usermod -aG docker ${USER}
   ```

3. (Optional) Make Raspian OS auto-update itself (confirm with `Yes` in the configuration)

   ```bash
   sudo apt-get install unattended-upgrades
   sudo dpkg-reconfigure -plow unattended-upgrades
   ```

### App

Clone this repo and create a `./.env` in the app folder with following content:

```bash
USERNAME=...
PASSWORD=...
METER_ID=...
INFLUX_ORG=ulrichlehner
INFLUX_BUCKET=smartmeter
INFLUX_TOKEN=<genereate a secure token string>
TZ=Europe/Vienna
DOCKER_INFLUXDB_INIT_USERNAME=admin
DOCKER_INFLUXDB_INIT_PASSWORD=<generate a secure password>
DOCKER_INFLUXDB_INIT_ORG=ulrichlehner
DOCKER_INFLUXDB_INIT_BUCKET=smartmeter
DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=<genereate a secure token string>
```

The variables `INFLUX_BUCKET` and `DOCKER_INFLUXDB_INIT_BUCKET` must have the same value, as well as `INFLUX_TOKEN` = `DOCKER_INFLUXDB_INIT_ADMIN_TOKEN` and `INFLUX_ORG` = `DOCKER_INFLUXDB_INIT_ORG`.

## Run

```bash
docker compose up --build
```

## Manually migrate data

Although a migration is performed when smartmeter data is fetched the first time, you can trigger a manual migration with following command:

```bash
docker compose run --rm databot pipenv run python3 main.py --migrate
```

## Grafana

Query all data:

```
from(bucket: "smartmeter")
  |> range(start: v.timeRangeStart, stop:v.timeRangeStop)
  |> filter(fn: (r) =>
    r._measurement == "meteredValues" and
    r._field == "value"
  )
```

Split in 6h time windows:

```
from(bucket: "smartmeter")
  |> range(start: v.timeRangeStart, stop:v.timeRangeStop)
  |> filter(fn: (r) =>
    r._measurement == "meteredValues" and
    r._field == "value"
  )
  |> aggregateWindow(every: 6h, offset: -2h, fn: mean)
```
