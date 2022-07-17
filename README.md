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
