import logging
import os
import urllib.parse
from argparse import ArgumentParser
from datetime import date, datetime, timedelta

import requests
from influxdb import InfluxDBClient

api_base_url = 'https://smartmeter.netz-noe.at/orchestration/'
db_name = 'smartmeter'
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


def scrape(day):
    response = session.get(
        api_base_url +
        f"ConsumptionRecord/Day?meterId={urllib.parse.quote(os.environ['METER_ID'])}&day={day}"
    )

    if response.status_code != 200:
        raise Exception('Fetching meter data failed')

    json = response.json()

    if not 'peakDemandTimes' in json or len(json['peakDemandTimes']) == 0:
        logging.warning(f"No measurement data for {day}")
        return False

    client = InfluxDBClient(
        host=os.environ['INFLUXDB_HOST'],
        port=os.environ['INFLUXDB_PORT']
    )

    if not db_name in list(map(lambda db: db['name'], client.get_list_database())):
        client.create_database(db_name)
        logging.info(f"Created DB '{db_name}'")

    client.switch_database(db_name)

    times = [{'time': x, 'index': i}
             for i, x in enumerate(json['peakDemandTimes'])]

    if client.write_points(
        list(
            map(lambda t: {
                'measurement': 'meteredPeakDemands',
                'tags': {'meterId': os.environ['METER_ID']},
                'time': t['time'],
                'fields': {'value': json['meteredPeakDemands'][t['index']]}
            }, times)
        )
        +
        list(
            map(lambda t: {
                'measurement': 'meteredValues',
                'tags': {'meterId': os.environ['METER_ID']},
                'time': t['time'],
                'fields': {'value': json['meteredValues'][t['index']]}
            }, times)
        )
    ):
        logging.info(f"Stored measurements in DB for {day}")

    return True


def main():
    logging.getLogger().setLevel(logging.INFO)
    parser = ArgumentParser()
    parser.add_argument('-m', '--migrate', default=False,
                        action='store_true', help='Migrate old measurement data into DB')
    args = parser.parse_args()

    login()
    if (args.migrate):
        delta_days = 1
        has_next = True
        max_attempts = 3
        attempts: 0
        while has_next:
            day = (date.today() - timedelta(days=delta_days)
                   ).strftime('%Y-%-m-%-d')
            try:
                if not scrape(day):
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
    else:
        try:
            scrape(datetime.now().strftime('%Y-%-m-%-d'))
        except Exception as err:
            logging.error(err)
            exit(1)

    logout()


if __name__ == '__main__':
    main()
