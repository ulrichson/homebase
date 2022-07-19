import logging
import os
import urllib.parse
from argparse import ArgumentParser
from datetime import datetime, timedelta

import pytz
import requests
from influxdb_client import InfluxDBClient, QueryApi, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS

api_base_url = 'https://smartmeter.netz-noe.at/orchestration/'
date_format = '%Y-%m-%d'

# Load environment variables
meter_id = os.environ['METER_ID']
tz = os.environ['TIMEZONE']
bucket = os.environ['INFLUX_BUCKET']
org = os.environ['INFLUX_ORG']
token = os.environ['INFLUX_TOKEN']
url = os.environ['INFLUX_URL']

session = requests.Session()
influxdb_client = InfluxDBClient(
    url=url,
    token=token,
    org=org
)


def login():
    response = session.post(
        api_base_url + 'Authentication/Login',
        json={
            'user': os.environ['USERNAME'],
            'pwd': os.environ['PASSWORD']
        }
    )
    if response.status_code != 200:
        raise Exception('Login failed')

    logging.info('Login successful')


def logout():
    response = session.get(api_base_url + 'Authentication/Logout')
    if response.status_code != 200:
        raise Exception('Logout failed')

    logging.info('Logout successful')


def load(day):
    response = session.get(
        api_base_url +
        f'ConsumptionRecord/Day?meterId={urllib.parse.quote(meter_id)}&day={day}'
    )

    if response.status_code != 200:
        raise Exception('Fetching meter data failed')

    json_respons = response.json()

    if not 'peakDemandTimes' in json_respons or len(json_respons['peakDemandTimes']) == 0:
        logging.warning(f'No measurement data for {day}')
        return False

    times = [{'time': x, 'index': i}
             for i, x in enumerate(json_respons['peakDemandTimes'])]

    data = list(
        map(lambda t: {
            'measurement': 'meteredPeakDemands',
            'tags': {'meterId': meter_id},
            'time': pytz.timezone(tz).localize(datetime.strptime(t['time'], '%Y-%m-%dT%H:%M:%S'), is_dst=None).astimezone(pytz.utc),
            'fields': {'value': json_respons['meteredPeakDemands'][t['index']]}
        }, times)
    ) + list(
        map(lambda t: {
            'measurement': 'meteredValues',
            'tags': {'meterId': meter_id},
            'time': pytz.timezone(tz).localize(datetime.strptime(t['time'], '%Y-%m-%dT%H:%M:%S'), is_dst=None).astimezone(pytz.utc),
            'fields': {'value': json_respons['meteredValues'][t['index']]}
        }, times)
    )

    write_api = influxdb_client.write_api(write_options=SYNCHRONOUS)
    if write_api.write(
        bucket=bucket,
        org=org,
        write_precision=WritePrecision.S,
        record=data
    ) is None:
        logging.info(f'Stored measurements in DB for {day}')

    return True


def migrate():
    delta_days = 1
    has_next = True
    max_failed_attempts = 3
    failed_attempts = 0
    allowed_empty_days = 7
    logging.info('Starting migrating old measurements')
    while has_next:
        day = (datetime.now(tz=pytz.timezone(tz)) - timedelta(days=delta_days)
               ).strftime(date_format)
        try:
            if not load(day):
                allowed_empty_days -= 1
            delta_days += 1
        except Exception as err:
            failed_attempts += 1
            logging.error(err)

        if failed_attempts >= max_failed_attempts or allowed_empty_days < 0:
            logging.info(
                'Stopping migration since no more data is present')
            has_next = False


def update():
    try:
        query_api = QueryApi(influxdb_client)
        flux_query = f'from(bucket: "{bucket}") ' \
            f'|> range(start: 0) ' \
            f'|> filter(fn: (r) => r._measurement == "meteredValues" and r._field == "value") ' \
            f'|> last()'
        response = query_api.query(flux_query)
        if len(response) == 0 or len(response[0].records) == 0:
            migrate()
        else:
            dt = response[0].records[0].get_time(
            ).astimezone(tz=pytz.timezone(tz))
            while dt <= datetime.now().astimezone(tz=pytz.timezone(tz)):
                load(dt.strftime(date_format))
                dt += timedelta(days=1)
    except Exception as err:
        logging.error(err)


def main():
    logging.getLogger().setLevel(logging.INFO)
    parser = ArgumentParser()
    parser.add_argument('-m', '--migrate', default=False,
                        action='store_true', help='Migrate old measurement data into DB')
    args = parser.parse_args()

    try:
        login()

        if (args.migrate):
            migrate()
        else:
            update()

        logout()
    except Exception as err:
        logging.error(err)


if __name__ == '__main__':
    main()
