import logging
import os
import urllib.parse
from argparse import ArgumentParser
from datetime import date, datetime, timedelta

import pytz
import requests
from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS

api_base_url = 'https://smartmeter.netz-noe.at/orchestration/'
session = requests.Session()


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
        f"ConsumptionRecord/Day?meterId={urllib.parse.quote(os.environ['METER_ID'])}&day={day}"
    )

    if response.status_code != 200:
        raise Exception('Fetching meter data failed')

    json_respons = response.json()

    if not 'peakDemandTimes' in json_respons or len(json_respons['peakDemandTimes']) == 0:
        logging.warning(f"No measurement data for {day}")
        return False

    client = InfluxDBClient(
        url=os.environ['INFLUX_URL'],
        token=os.environ['INFLUX_TOKEN'],
        org=os.environ['INFLUX_ORG']
    )

    times = [{'time': x, 'index': i}
             for i, x in enumerate(json_respons['peakDemandTimes'])]

    data = list(
        map(lambda t: {
            'measurement': 'meteredPeakDemands',
            'tags': {'meterId': os.environ['METER_ID']},
            'time': pytz.timezone(os.environ['TIMEZONE']).localize(datetime.strptime(t['time'], "%Y-%m-%dT%H:%M:%S"), is_dst=None).astimezone(pytz.utc),
            'fields': {'value': json_respons['meteredPeakDemands'][t['index']]}
        }, times)
    ) + list(
        map(lambda t: {
            'measurement': 'meteredValues',
            'tags': {'meterId': os.environ['METER_ID']},
            'time': pytz.timezone(os.environ['TIMEZONE']).localize(datetime.strptime(t['time'], "%Y-%m-%dT%H:%M:%S"), is_dst=None).astimezone(pytz.utc),
            'fields': {'value': json_respons['meteredValues'][t['index']]}
        }, times)
    )

    write_api = client.write_api(write_options=SYNCHRONOUS)
    if write_api.write(
        bucket=os.environ['INFLUX_BUCKET'],
        org=os.environ['INFLUX_ORG'],
        write_precision=WritePrecision.S,
        record=data
    ) is None:
        logging.info(f"Stored measurements in DB for {day}")

    return True


def migrate():
    delta_days = 1
    has_next = True
    max_attempts = 3
    attempts = 0
    while has_next:
        day = (date.today() - timedelta(days=delta_days)
               ).strftime('%Y-%-m-%-d')
        try:
            if not load(day):
                attempts += 1
            else:
                delta_days += 1
                attempts = 0
        except Exception as err:
            attempts += 1
            logging.error(err)

        if (attempts >= max_attempts):
            logging.info(
                'Stopping migration since no more data is present')
            has_next = False


def main():
    logging.getLogger().setLevel(logging.INFO)
    parser = ArgumentParser()
    parser.add_argument('-m', '--migrate', default=False,
                        action='store_true', help='Migrate old measurement data into DB')
    args = parser.parse_args()

    login()
    if (args.migrate):
        migrate()
    else:
        try:
            load(datetime.now().strftime('%Y-%-m-%-d'))
        except Exception as err:
            logging.error(err)

    logout()


if __name__ == '__main__':
    main()
