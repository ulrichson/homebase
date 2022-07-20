from cmath import nan
import logging
import os
from datetime import datetime, timedelta

import matplotlib
import matplotlib.pyplot as plt
import numpy as np
import pytz
from influxdb_client import InfluxDBClient, QueryApi

# Load environment variables
meter_id = os.environ['METER_ID']
tz = os.environ['TZ']
bucket = os.environ['INFLUX_BUCKET']
org = os.environ['INFLUX_ORG']
token = os.environ['INFLUX_TOKEN']
url = os.environ['INFLUX_URL']

labels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
x_label_locations = np.arange(len(labels))  # the label locations
width = 0.2  # the width of the bars

influxdb_client = InfluxDBClient(
    url=url,
    token=token,
    org=org
)


def get_values(weeks_back):
    today = datetime.now()
    today = today.replace(hour=0, minute=0, second=0, microsecond=0)
    start = today - timedelta(days=today.weekday(), weeks=weeks_back)
    stop = start + timedelta(weeks=1)
    start += timedelta(hours=6)

    # Convert to UTC as it's stored in DB
    start = pytz.timezone(tz).localize(start).astimezone(pytz.UTC)
    stop = pytz.timezone(tz).localize(stop).astimezone(pytz.UTC)

    query_api = QueryApi(influxdb_client)
    flux_query = f'from(bucket: "{bucket}") ' \
        f'|> range(start: time(v: "{start.strftime("%Y-%m-%dT%H:%M:%SZ")}"), stop: time(v: "{stop.strftime("%Y-%m-%dT%H:%M:%SZ")}")) ' \
        f'|> filter(fn: (r) => r._measurement == "meteredValues" and r._field == "value") ' \
        '|> map(fn: (r) => ({r with _value: r._value * 1000.0 })) ' \
        f'|> aggregateWindow(every: 6h, createEmpty: false, fn: mean)'

    response = query_api.query(flux_query)
    if len(response) == 0 or len(response[0].records) == 0:
        raise Exception('Cannot render chart since no data is available')

    values = list(map(lambda r: r.get_value(), response[0].records))

    # print(list(map(lambda r: r.get_time().strftime(
    #     "%Y-%m-%d, %H:%M"), response[0].records)))
    # print('\n')

    return values


def add_values(idx, values, axs, ylabel):
    day_part_1_means = []
    day_part_2_means = []
    day_part_3_means = []
    day_part_4_means = []

    for i in range(len(labels)):
        try:
            day_part_1_means.append(values[i * 4 + 0])
        except:
            day_part_1_means.append(nan)
        try:
            day_part_2_means.append(values[i * 4 + 1])
        except:
            day_part_2_means.append(nan)
        try:
            day_part_3_means.append(values[i * 4 + 2])
        except:
            day_part_3_means.append(nan)
        try:
            day_part_4_means.append(values[i * 4 + 3])
        except:
            day_part_4_means.append(nan)

    rects1 = axs[idx].bar(x_label_locations - (width * 1.5), day_part_1_means, width,
                          label='00:00-06:00', color='lightgray')
    rects2 = axs[idx].bar(x_label_locations - (width * 0.5), day_part_2_means, width,
                          label='06:00-12:00', color='gray')
    rects3 = axs[idx].bar(x_label_locations + (width * 0.5), day_part_3_means, width,
                          label='12:00-18:00', color='dimgray')
    rects4 = axs[idx].bar(x_label_locations + (width * 1.5), day_part_4_means, width,
                          label='18:00-24:00', color='darkgray')
    axs[idx].set_ylabel(ylabel)
    axs[idx].set_xticks(x_label_locations, labels)

    axs[idx].bar_label(rects1, rotation='vertical', label_type='center',
                       fmt='%.0f', fontsize=8, fontweight='normal')
    axs[idx].bar_label(rects2, rotation='vertical', label_type='center',
                       fmt='%.0f', fontsize=8, fontweight='normal')
    axs[idx].bar_label(rects3, rotation='vertical', label_type='center',
                       fmt='%.0f', fontsize=8, fontweight='normal')
    axs[idx].bar_label(rects4, rotation='vertical', label_type='center',
                       fmt='%.0f', fontsize=8, fontweight='normal')

    # Avoid that yaxix label sticks on the border
    axs[idx].yaxis.set_label_coords(-0.1, 0.5)


def main():
    logging.getLogger().setLevel(logging.INFO)
    logging.basicConfig(
        format='[ %(asctime)s %(levelname)s ]\t%(message)s')

    try:
        # Make it appear a little differen
        matplotlib.rcParams['font.family'] = ['monospace']
        matplotlib.rcParams['font.size'] = 8
        matplotlib.rcParams['font.weight'] = 'bold'

        # Plot data
        fig = plt.figure()
        gs = fig.add_gridspec(3, hspace=0)
        axs = gs.subplots(sharex=True, sharey=True)
        add_values(idx=0, values=get_values(weeks_back=0),
                   axs=axs, ylabel='Aktuelle Woche')
        add_values(idx=1, values=get_values(weeks_back=1),
                   axs=axs, ylabel='Letzte Woche')
        add_values(idx=2, values=get_values(weeks_back=2),
                   axs=axs, ylabel='Vorletzte Woche')

        axs[2].legend(loc='upper center', bbox_to_anchor=(
            0.5, -0.2), ncol=4, frameon=False)

        fig.suptitle('Stromverbrauch (Wh)')
        fig.tight_layout()
        fig.set_size_inches(6, 8)

        # Remove `0` tick to avoid layout collisions with neighbor charts
        for ax in axs:
            ax.yaxis.get_major_ticks()[0].label1.set_visible(False)
            ax.yaxis.get_major_ticks()[0].tick1line.set_visible(False)

        os.makedirs('export', exist_ok=True)
        plt.savefig('export/current.png', dpi=100)
        # plt.show()

        logging.info('Rendered latest chart')

    except Exception as err:
        logging.error(err)
        exit(1)


if __name__ == '__main__':
    main()
