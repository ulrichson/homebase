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
width = 0.25  # the width of the bars

influxdb_client = InfluxDBClient(
    url=url,
    token=token,
    org=org
)
query_api = QueryApi(influxdb_client)


def get_datetime_range(weeks_back):
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

    return start.strftime("%Y-%m-%dT%H:%M:%SZ"), stop.strftime("%Y-%m-%dT%H:%M:%SZ"), offset


def get_line_chart_values(weeks_back):
    start, stop, offset = get_datetime_range(weeks_back)

    # '|> map(fn: (r) => ({r with _value: r._value * 1000.0 })) ' -> add if you want Wh instead of kWh
    flux_query = f'from(bucket: "{bucket}") ' \
        f'|> range(start: time(v: "{start}"), stop: time(v: "{stop}")) ' \
        f'|> filter(fn: (r) => r._measurement == "meteredValues" and r._field == "value")' \
        f'|> aggregateWindow(every: 1h, createEmpty: false, offset: {offset}, fn: sum)'

    # logging.info(f'Query:\n\t{flux_query}')

    response = query_api.query(flux_query)
    if len(response) == 0 or len(response[0].records) == 0:
        logging.warning(f'No line chart data between {start} and {stop}')
        return []

    values = list(map(lambda r: r.get_value(), response[0].records))

    return values


def get_bar_chart_values(weeks_back):
    start, stop, offset = get_datetime_range(weeks_back)

    # '|> map(fn: (r) => ({r with _value: r._value * 1000.0 })) ' -> add if you want Wh instead of kWh
    flux_query = f'from(bucket: "{bucket}") ' \
        f'|> range(start: time(v: "{start}"), stop: time(v: "{stop}")) ' \
        f'|> filter(fn: (r) => r._measurement == "meteredValues" and r._field == "value") ' \
        f'|> aggregateWindow(every: 6h, createEmpty: false, offset: {offset}, fn: sum)'

    # logging.info(f'Query:\n\t{flux_query}')

    response = query_api.query(flux_query)
    if len(response) == 0 or len(response[0].records) == 0:
        logging.warning(f'No bar chart data between {start} and {stop}')
        return []

    values = list(map(lambda r: r.get_value(), response[0].records))

    return values


def add_bars(idx, values, axs, ylabel):
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
    total = 0
    cnt = 0
    for i in range(len(labels)):
        sum = day_part_1_sums[i] + day_part_2_sums[i] + \
            day_part_3_sums[i] + day_part_4_sums[i]
        if sum > 0:
            total += sum
            cnt += 1
            axs[idx].text(x=i, y=0.15, s=fmt % sum, fontsize=5, horizontalalignment='center', bbox=dict(
                facecolor='white', alpha=0.3, boxstyle='round', edgecolor='none', pad=0.2))

    # Add total to right (faking it as an 8th column outside the plot)
    if total > 0 and cnt > 0:
        axs[idx].text(x=7, y=0.2, s='Ø = {:.2f}   Σ = {:.2f}'.format(total / cnt, total),
                      fontsize=6, rotation=90, horizontalalignment='center', verticalalignment='bottom')

    # Avoid that yaxix label sticks on the border
    # axs[idx].yaxis.set_label_coords(-0.1, 0.5)

    # Leave some room above so that the labels above the bar won't overflow the chart
    axs[idx].margins(x=0, y=0.15)

    # Add grid lines to distinguish day groupts
    axs[idx].set_xticks([0.5, 1.5, 2.5, 3.5, 4.5, 5.5], minor=True)
    axs[idx].xaxis.grid(visible=True, linestyle=':', color='black',
                        linewidth=0.8, which='minor')


def add_line(idx, values, axs):
    axs[idx].plot(values, linewidth=0.5, color='black', alpha=0.3)

    axs[idx].set_facecolor((0, 0, 0, 0))
    axs[idx].axes.xaxis.set_visible(False)
    axs[idx].axes.yaxis.set_visible(False)

    axs[idx].margins(x=0, y=0)


def main():
    logging.getLogger().setLevel(os.environ.get('LOGLEVEL', 'INFO').upper())
    logging.basicConfig(
        format='[ %(asctime)s %(levelname)s ] %(message)s')

    try:
        logging.info('Rendering chart started')

        # Make it appear a little differen
        matplotlib.rcParams['font.family'] = ['monospace']
        matplotlib.rcParams['font.size'] = 6
        matplotlib.rcParams['font.weight'] = 'bold'

        fig = plt.figure()

        # Plot bar data
        gs1 = fig.add_gridspec(3, hspace=0)
        axs1 = gs1.subplots(sharex=True, sharey=True)
        add_bars(idx=0, values=get_bar_chart_values(weeks_back=0),
                 axs=axs1, ylabel='Aktuelle Woche')
        add_bars(idx=1, values=get_bar_chart_values(weeks_back=1),
                 axs=axs1, ylabel='Letzte Woche')
        add_bars(idx=2, values=get_bar_chart_values(weeks_back=2),
                 axs=axs1, ylabel='Vorletzte Woche')

        axs1[2].legend(loc='upper center', bbox_to_anchor=(
            0.5, -0.2), ncol=4, frameon=False, fontsize=6, handlelength=1)

        # Plot line data
        gs2 = fig.add_gridspec(3, hspace=0)
        axs2 = gs2.subplots(sharex=True, sharey=True)
        add_line(idx=0, values=get_line_chart_values(weeks_back=0), axs=axs2)
        add_line(idx=1, values=get_line_chart_values(weeks_back=1), axs=axs2)
        add_line(idx=2, values=get_line_chart_values(weeks_back=2), axs=axs2)

        # Remove `0` tick to avoid layout collisions with neighbor charts
        for ax in axs1:
            ax.yaxis.get_major_ticks()[0].label1.set_visible(False)
            ax.yaxis.get_major_ticks()[0].tick1line.set_visible(False)
            ax.xaxis.get_minor_ticks()[0].tick1line.set_visible(False)
            ax.xaxis.get_minor_ticks()[1].tick1line.set_visible(False)
            ax.xaxis.get_minor_ticks()[2].tick1line.set_visible(False)
            ax.xaxis.get_minor_ticks()[3].tick1line.set_visible(False)
            ax.xaxis.get_minor_ticks()[4].tick1line.set_visible(False)
            ax.xaxis.get_minor_ticks()[5].tick1line.set_visible(False)

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
