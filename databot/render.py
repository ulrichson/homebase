import logging
import os
from cmath import nan
from datetime import datetime, timedelta

import matplotlib
import matplotlib.pyplot as plt
import numpy as np
import pytz
from influxdb_client import InfluxDBClient, QueryApi
from PIL import Image

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

    # Add 15 min to be coherent with NÖ Netz interval
    start += timedelta(minutes=15)
    stop += timedelta(minutes=15)

    # UTC offset - 15min for correct interval
    offset = '-{:.0f}m'.format(pytz.timezone(tz).localize(
        today).utcoffset().total_seconds() / 60 - 15)

    # Convert to UTC as it's stored in DB
    start = pytz.timezone(tz).localize(start).astimezone(pytz.UTC)
    stop = pytz.timezone(tz).localize(stop).astimezone(pytz.UTC)

    query_api = QueryApi(influxdb_client)
    # '|> map(fn: (r) => ({r with _value: r._value * 1000.0 })) ' -> add if you want Wh instead of kWh
    flux_query = f'from(bucket: "{bucket}") ' \
        f'|> range(start: time(v: "{start.strftime("%Y-%m-%dT%H:%M:%SZ")}"), stop: time(v: "{stop.strftime("%Y-%m-%dT%H:%M:%SZ")}")) ' \
        f'|> filter(fn: (r) => r._measurement == "meteredValues" and r._field == "value") ' \
        f'|> aggregateWindow(every: 6h, createEmpty: false, offset: {offset}, fn: sum)'

    # logging.info(f'Query:\n\t{flux_query}')

    response = query_api.query(flux_query)
    if len(response) == 0 or len(response[0].records) == 0:
        raise Exception('Cannot render chart since no data is available')

    values = list(map(lambda r: r.get_value(), response[0].records))

    # print(list(map(lambda r: r.get_time().strftime(
    #     "%Y-%m-%d, %H:%M"), response[0].records)))
    # print('\n')

    return values


def add_values(idx, values, axs, ylabel):
    day_part_1_sums = []
    day_part_2_sums = []
    day_part_3_sums = []
    day_part_4_sums = []

    for i in range(len(labels)):
        try:
            day_part_1_sums.append(values[i * 4 + 0])
        except:
            day_part_1_sums.append(nan)
        try:
            day_part_2_sums.append(values[i * 4 + 1])
        except:
            day_part_2_sums.append(nan)
        try:
            day_part_3_sums.append(values[i * 4 + 2])
        except:
            day_part_3_sums.append(nan)
        try:
            day_part_4_sums.append(values[i * 4 + 3])
        except:
            day_part_4_sums.append(nan)

    rects1 = axs[idx].bar(x_label_locations - (width * 1.5), day_part_1_sums, width,
                          label='00:00-06:00', color='lightgray')
    rects2 = axs[idx].bar(x_label_locations - (width * 0.5), day_part_2_sums, width,
                          label='06:00-12:00', color='gray')
    rects3 = axs[idx].bar(x_label_locations + (width * 0.5), day_part_3_sums, width,
                          label='12:00-18:00', color='dimgray')
    rects4 = axs[idx].bar(x_label_locations + (width * 1.5), day_part_4_sums, width,
                          label='18:00-24:00', color='darkgray')
    axs[idx].set_ylabel(ylabel)
    axs[idx].set_xticks(x_label_locations, labels)

    fmt = '%.2f'
    padding = 2
    axs[idx].bar_label(rects1, rotation='vertical',  padding=padding,  # label_type='center',
                       fmt=fmt, fontsize=4, fontweight='normal')
    axs[idx].bar_label(rects2, rotation='vertical',  padding=padding,  # label_type='center',
                       fmt=fmt, fontsize=4, fontweight='normal')
    axs[idx].bar_label(rects3, rotation='vertical',  padding=padding,  # label_type='center',
                       fmt=fmt, fontsize=4, fontweight='normal')
    axs[idx].bar_label(rects4, rotation='vertical',  padding=padding,  # label_type='center',
                       fmt=fmt, fontsize=4, fontweight='normal')

    # Add daily sums to bottom of each group
    for i in range(len(labels)):
        sum = day_part_1_sums[i] + day_part_2_sums[i] + \
            day_part_3_sums[i] + day_part_4_sums[i]
        if sum > 0:
            axs[idx].text(x=i, y=0.15, s=fmt % sum, fontsize=5, horizontalalignment='center',
                          bbox=dict(facecolor='white', alpha=0.3, boxstyle='round', edgecolor='none', pad=0.2))

    # Avoid that yaxix label sticks on the border
    # axs[idx].yaxis.set_label_coords(-0.1, 0.5)

    # Leave some room above so that the labels above the bar won't overflow the chart
    axs[idx].margins(y=0.15)


def main():
    logging.getLogger().setLevel(os.environ.get('LOGLEVEL', 'INFO').upper())
    logging.basicConfig(
        format='[ %(asctime)s %(levelname)s\t] %(message)s')

    try:
        logging.info('Rendering chart started')

        # Make it appear a little differen
        matplotlib.rcParams['font.family'] = ['monospace']
        matplotlib.rcParams['font.size'] = 6
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
            0.5, -0.2), ncol=4, frameon=False, fontsize=6, handlelength=1)

        # Remove `0` tick to avoid layout collisions with neighbor charts
        for ax in axs:
            ax.yaxis.get_major_ticks()[0].label1.set_visible(False)
            ax.yaxis.get_major_ticks()[0].tick1line.set_visible(False)

        os.makedirs('export', exist_ok=True)

        fig.suptitle('Stromverbrauch (kWh)')
        # fig.tight_layout()
        fig.subplots_adjust(top=0.95)

        # Kindle Paperwhite has native resolution of 1024 x 758 px @ 212 dpi
        dpi = 212
        # Some buffer needed to actually get 758w ...
        fig.set_size_inches(760 / dpi, 1024 / dpi)
        plt.savefig('export/current.png', dpi=dpi)
        # plt.show()

        # Convert to greyscale supported by Kindle
        img = Image.open('export/current.png').convert('L')
        img.save('export/current.png')

        logging.info('Rendering chart done')

    except Exception as err:
        logging.error(err)
        exit(1)


if __name__ == '__main__':
    main()
