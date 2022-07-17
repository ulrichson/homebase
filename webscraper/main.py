import logging
import os
import urllib.parse
from datetime import datetime

import requests
from influxdb import InfluxDBClient

api_base_url = 'https://smartmeter.netz-noe.at/orchestration/'
db_name = 'smartmeter'


def scrape(day):
    session = requests.Session()
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

    response = session.get(
        api_base_url +
        f"ConsumptionRecord/Day?meterId={urllib.parse.quote(os.environ['METER_ID'])}&day={day}"
    )

    if response.status_code != 200:
        session.get(api_base_url + 'Authentication/Logout')
        raise Exception('Fetching meter data failed')

    json = response.json()

    if not 'peakDemandTimes' in json or len(json['peakDemandTimes']) == 0:
        session.get(api_base_url + 'Authentication/Logout')
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
        logging.info('Stored measurements in DB')

    session.get(api_base_url + 'Authentication/Logout')
    return True


def main():
    day = os.environ['DAY'] if 'DAY' in os.environ else datetime.now().strftime(
        '%Y-%-m-%-d')
    logging.getLogger().setLevel(logging.INFO)
    try:
        scrape(day)
    except Exception as err:
        logging.error(err)
        exit(1)


if __name__ == '__main__':
    main()
