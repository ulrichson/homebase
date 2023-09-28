#!/usr/bin/env node

import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { Command } from 'commander';
import * as dotenv from 'dotenv';
import { DateTime } from 'luxon';
import moment, { Moment } from 'moment-timezone';
import fs from 'node:fs';
import puppeteer, { Page } from 'puppeteer';

const dateFormat = 'DD.MM.YYYY';
const maxFailedAttempts = 5;

async function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function hasDockerEnv() {
  try {
    fs.statSync('/.dockerenv');
    return true;
  } catch {
    return false;
  }
}

function hasDockerCGroup() {
  try {
    return fs.readFileSync('/proc/self/cgroup', 'utf8').includes('docker');
  } catch {
    return false;
  }
}

function isDocker() {
  return hasDockerEnv() || hasDockerCGroup();
}

function getDatetimeRange(weeksBack: number, date: DateTime, tz: string) {
  const format = "yyyy-MM-dd'T'HH:mm:ss'Z'";
  date = date.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });
  const start = date.minus({ days: date.weekday, weeks: weeksBack });
  const stop = start.plus({ weeks: 1 });
  return {
    start: start.toUTC().toFormat(format),
    stop: stop.toUTC().toFormat(format),

    format,
  };
}

interface Config {
  meterId: string;
  tz: string;
  influxBucket: string;
  influxOrg: string;
  influxToken: string;
  influxUrl: string;
  username: string;
  password: string;
  debug: boolean;
}

interface TableRow {
  [header: string]: number | Date | string | null;
}

interface TableData {
  headers: string[];
  rows: TableRow[];
}

class Bot {
  // public readonly ready: Promise<void>;
  // private browser?: Browser;
  // private page?: Page;

  constructor(private config: Config, private influxDb: InfluxDB) {
    // this.ready = new Promise(async (resolve, reject) => {
    //   try {
    //     await this.init();
    //     resolve();
    //   } catch (e) {
    //     reject(e);
    //   }
    // });
  }

  /**
   * Loads the consumption data for the given day and stores it in the DB
   * @param day - Date with format DD.MM.YYYY
   *
   * @return The number of saved data points or `-1` if an error occured
   */
  async load(day: string): Promise<number> {
    let ret = 0;
    try {
      const data = await this.fetch(day);
      if (!data) {
        throw 'No data was returned';
      }
      // console.log(
      //   data
      //     .filter((row) => (<any>row).name === 'meteredValues')
      //     .map((row) => `${(<any>row).time}: ${row.fields.value}`)
      // );
      ret = data.length;
      const writeApi = this.influxDb.getWriteApi(
        this.config.influxOrg,
        this.config.influxBucket,
        's'
      );
      writeApi.writePoints(data);
      writeApi.close();
      console.info(`Stored measurements in DB for ${day}`);
    } catch {
      return -1;
    }
    return ret;
  }

  /**
   * Fetches the consumption data for the given day
   * @param day - Date with format DD.MM.YYYY
   *
   * @return The data points, or null if it failed
   */
  async fetch(day: string) {
    let ret: Point[] | null = null;
    const browser = isDocker()
      ? await puppeteer.launch({
          executablePath: '/usr/bin/chromium',
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        })
      : await puppeteer.launch({ headless: !this.config.debug });
    const page = await browser.newPage();

    page.on('console', (msg) => console.debug('BROWSER DEBUG: ', msg.text()));

    console.debug('Navigate to login');
    await page.goto('https://www.linznetz.at', {
      waitUntil: 'domcontentloaded',
    });
    await Promise.all([
      page.waitForNavigation({
        waitUntil: 'domcontentloaded',
      }),
      page.click('#loginFormTemplateHeader\\:doLogin'),
    ]);

    console.debug('Enter credentials');
    await page.type('#username', this.config.username);
    await page.type('#password', this.config.password);

    await page.evaluate(
      (form) => form?.submit(),
      await page.$('form[name="loginForm"]')
    );
    await page.waitForNavigation();

    console.debug('Login successful');

    console.debug('Navigate to consumption page');
    await page.goto(
      'https://www.linznetz.at/portal/start.app?id=8&nav=/de_1/linz_netz_website/online_services/serviceportal/meine_verbraeuche/verbrauchsdateninformation/verbrauchsdateninformation.nav.xhtml',
      {
        waitUntil: 'domcontentloaded',
      }
    );

    console.debug('Select "Viertelstundenwerte"');
    await page.click('label::-p-text(Viertelstundenwerte)');
    await page.waitForSelector('label::-p-text(Energiemenge in kWh)');

    console.debug('Enter date range ' + day);
    await new Promise((r) => setTimeout(r, 500));
    const inputFrom = await page.$('#myForm1\\:calendarFromRegion');
    await inputFrom?.click({ clickCount: 2 });
    await inputFrom?.type(day);
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 500));
    const inputTo = await page.$('#myForm1\\:calendarToRegion');
    await inputTo?.click({ clickCount: 2 });
    await inputTo?.type(day);
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 500));

    const fromValue = await page.$eval(
      '#myForm1\\:calendarFromRegion',
      (el) => (<any>el).value
    );
    const toValue = await page.$eval(
      '#myForm1\\:calendarToRegion',
      (el) => (<any>el).value
    );

    console.debug('Date input from value: ' + fromValue);
    console.debug('Date input to value: ' + toValue);

    if (day !== fromValue || day !== toValue) {
      throw new Error('Date input not set correctly');
    }

    try {
      console.debug('Select "Energiemenge in kWh"');
      // No need to click, it's pre-selected
      // page.click('label::-p-text(Energiemenge in kWh)');
      const meteredValuesDataTable = await this.downloadResult(
        page /*'Energiemenge'*/
      );

      console.debug('Select "Leistung in kW"');
      page.click('label::-p-text(Leistung in kW)');
      await page.waitForResponse((response) => {
        return response.request().url().includes('/consumption.jsf');
      });
      console.debug('Reset pagination');
      const disabledResetPagiationLink = await page.$(
        '.ui-paginator-first.ui-state-disabled'
      );
      if (!disabledResetPagiationLink) {
        await page.click('.ui-paginator-first');
        await page.waitForResponse((response) => {
          return response.request().url().includes('/consumption.jsf');
        });
      }

      const meteredPeakDemandsDataTable = await this.downloadResult(
        page /*'Leistung'*/
      );

      const data = [
        ...meteredPeakDemandsDataTable.rows.map((row) => {
          const dateKey = meteredPeakDemandsDataTable.headers[0];
          const valueKey = meteredPeakDemandsDataTable.headers[1];
          const substituteValueKey = meteredPeakDemandsDataTable.headers[2];
          return new Point('meteredPeakDemands')
            .tag('meterId', this.config.meterId)
            .timestamp(row[dateKey] as Date)
            .floatField('value', row[valueKey] ?? row[substituteValueKey]);
        }),
        ...meteredValuesDataTable.rows.map((row) => {
          const dateKey = meteredValuesDataTable.headers[0];
          const valueKey = meteredValuesDataTable.headers[1];
          const substituteValueKey = meteredValuesDataTable.headers[2];
          return new Point('meteredValues')
            .tag('meterId', this.config.meterId)
            .timestamp(row[dateKey] as Date)
            .floatField('value', row[valueKey] ?? row[substituteValueKey]);
        }),
      ];
      ret = data;
    } catch (err) {
      console.warn(`No measurement data for ${day}`);
      console.debug((<Error>err).stack);
      if (this.config.debug) {
        try {
          await page.screenshot({
            path: `/app/export/.error_${moment().format(
              'YYYY-MM-DD_hh-mm-ss'
            )}_${new Date().getTime()}.png`,
          });
        } catch {}
      }
      return null;
    }

    try {
      console.debug('Navigate to logout');
      await page.goto(
        'https://sso.linznetz.at/auth/realms/netzsso/protocol/openid-connect/logout?redirect_uri=https%3A%2F%2Fwww.linznetz.at%2Fportal%2Fde%2Fhome%2Fonline_services%2Fserviceportal',
        {
          waitUntil: 'domcontentloaded',
        }
      );

      console.debug('Logout successful');
    } catch (err) {
      console.warn(`Cannot logout`);
      console.debug((<Error>err).stack);
    } finally {
      try {
        await browser.close();
      } catch (err) {
        console.warn(`Cannot close browser`);
        console.debug((<Error>err).stack);
      } finally {
        // Kill browser if it is still running
        browser.process()?.kill('SIGINT');
      }
    }

    return ret;
  }

  private async downloadResult(
    page: Page /*, expect: 'Energiemenge' | 'Leistung'*/
  ) {
    if (!page) {
      throw new Error('Not initialized');
    }

    console.debug('Click "Anzeigen"');
    // await page.waitForSelector('#myForm1\\:btnIdA1', { visible: true });
    await page.click('input[value="Anzeigen"]'); // Button "Anzeigen"

    console.debug('Wait for result');
    await page.waitForResponse((response) => {
      return response.request().url().includes('/consumption.jsf');
    });
    // await page.waitForFunction(
    //   `document.querySelector("body").innerText.includes("${expect}")`
    // );
    // await page.waitForNetworkIdle();
    // await page.waitForResponse((response) => {
    //   return response.request().url().includes('/consumption.jsf');
    // });
    // await new Promise((r) => setTimeout(r, 500));

    let hasNext = true;
    const tableData: TableData = { headers: [], rows: [] };

    while (hasNext) {
      const pageTableData = await this.tableToJson(
        page,
        '#myForm1\\:consumptionsTable table'
      );

      tableData.headers = pageTableData.headers;
      tableData.rows.push(...pageTableData.rows);

      const nextButton = await page.$(
        '#myForm1\\:consumptionsTable_paginator_bottom a.ui-paginator-next'
      );

      hasNext =
        !(await page.evaluate(
          (el) => el?.classList.contains('ui-state-disabled'),
          nextButton
        )) ?? false;
      if (hasNext) {
        await nextButton?.click();
        // await page.waitForResponse((response) => {
        //   return response.request().url().includes('/consumption.jsf');
        // });
        await page.waitForNetworkIdle();
      }
    }

    console.debug(`Received ${tableData.rows.length} data rows`);

    return tableData;
  }

  private async tableToJson(
    page: Page,
    tableSelector: string
  ): Promise<TableData> {
    const table = (await page.$$(tableSelector))[0];
    const thead = await table.$('thead');
    const tbody = await table.$('tbody');
    const ths = await thead!.$$('th');
    const trs = await tbody!.$$('tr');
    const rows: TableRow[] = [];
    const headers: string[] = [];
    for (const th of ths) {
      const thText = await (await th.getProperty('textContent')).jsonValue();
      headers.push(thText?.trim() ?? 'N/A');
    }
    for (const tr of trs) {
      const tds = await tr.$$eval('td', (tds) =>
        tds.map((td) => td.textContent!.trim())
      );
      rows.push(
        headers.reduce((acc, th, index) => {
          const number = Number(tds[index].replace(',', '.'));
          const date = moment
            .tz(tds[index], 'DD.MM.YYYY hh:mm', this.config.tz)
            .toDate();
          acc[th] = !tds[index]
            ? null
            : !Number.isNaN(number)
            ? number
            : !Number.isNaN(date.getTime())
            ? date
            : tds[index];
          return acc;
        }, {} as TableRow)
      );
    }
    return { headers, rows };
  }
}
async function migrate({
  bot,
  config,
  limitDaysBack,
  from = moment(),
}: {
  bot: Bot;
  config: Config;
  limitDaysBack?: number;
  from?: Moment;
}) {
  let deltaDays = 0;
  let hasNext = true;
  let failedAttempts = 0;
  let allowedEmptyDays = 7;

  console.info(
    'Loading past measurements' +
      (typeof limitDaysBack !== 'undefined'
        ? ` of last ${limitDaysBack} day${limitDaysBack !== 1 ? 's' : ''}`
        : '') +
      ' back from ' +
      from.tz(config.tz).format(dateFormat)
  );

  while (hasNext) {
    const day = from
      .clone()
      .tz(config.tz)
      .subtract(deltaDays, 'days')
      .format(dateFormat);

    await sleep(failedAttempts > 0 ? 5000 : 300); // Avoid rate limiting
    if (failedAttempts > 0) {
      console.log(`Retrying for ${day} ...`);
    }
    const result = await bot.load(day);
    if (result === 0) {
      allowedEmptyDays -= 1;
      deltaDays += 1;
      failedAttempts = 0;
    } else if (
      result ===
      24 /* hours a day */ * 4 /* quarter hours */ * 2 /* data rows */
    ) {
      deltaDays += 1;
      failedAttempts = 0;
    } else {
      failedAttempts += 1;
    }

    if (failedAttempts > maxFailedAttempts || allowedEmptyDays < 0) {
      console.info('Stopping since no more data is present');
      hasNext = false;
    }

    if (typeof limitDaysBack !== 'undefined' && deltaDays >= limitDaysBack) {
      hasNext = false;
    }
  }
}

async function continueMigration({
  bot,
  config,
  influxDb,
}: {
  bot: Bot;
  config: Config;
  influxDb: InfluxDB;
}) {
  const queryApi = influxDb.getQueryApi(config.influxOrg);
  const fluxQuery = `
      from(bucket: "${config.influxBucket}")
      |> range(start: 0)
      |> filter(fn: (r) => r._measurement == "meteredValues" and r._field == "value")
      |> first()
    `;
  const response = await queryApi.collectRows(fluxQuery);
  if (response.length === 0) {
    console.warn('No date present to continue migration');
    return;
  } else {
    let from = moment((<any>response[0])['_time']);
    const bufferDays =
      from < moment().subtract(2, 'days')
        ? 2
        : from < moment().subtract(1, 'days')
        ? 1
        : 0;
    from.add(bufferDays, 'days');
    await migrate({ bot, config, from });
  }
}

async function update({
  bot,
  config,
  influxDb,
}: {
  bot: Bot;
  config: Config;
  influxDb: InfluxDB;
}) {
  const queryApi = influxDb.getQueryApi(config.influxOrg);
  const fluxQuery = `
      from(bucket: "${config.influxBucket}")
      |> range(start: 0)
      |> filter(fn: (r) => r._measurement == "meteredValues" and r._field == "value")
      |> last()
    `;
  const response = await queryApi.collectRows(fluxQuery);
  if (response.length === 0) {
    await migrate({ bot, config });
  } else {
    console.log('Loading latest measurement(s)');
    let dt = moment((<any>response[0])['_time']).tz(config.tz);
    const endOfToday = moment()
      .tz(config.tz)
      .set('hours', 0)
      .set('minutes', 0)
      .add(1, 'days');
    let failedAttempts = 0;
    while (dt <= endOfToday && failedAttempts <= maxFailedAttempts) {
      const day = dt.format(dateFormat);
      if (failedAttempts > 0) {
        console.log(`Fetching measurements for ${day} failed, will retry ...`);
      }
      await sleep(failedAttempts > 0 ? 5000 : 300); // Avoid rate limiting
      const result = await bot.load(day);
      if (result < 0) {
        failedAttempts++;
      } else {
        failedAttempts = 0;
        dt.add(1, 'days');
      }
    }

    // Re-load older measurements in case they were updated
    await migrate({
      bot,
      config,
      from: moment((<any>response[0])['_time']).subtract(1, 'days'),
      limitDaysBack: 7,
    });
  }
}

async function doctor({
  bot,
  config,
  influxDb,
  limitDaysBack,
}: {
  bot: Bot;
  config: Config;
  influxDb: InfluxDB;
  limitDaysBack?: number;
}) {
  try {
    const queryApi = influxDb.getQueryApi(config.influxOrg);
    let fluxQuery = `
      from(bucket: "${config.influxBucket}")
      |> range(start: 0)
      |> filter(fn: (r) => r._measurement == "meteredValues" and r._field == "value")
      |> last()
    `;
    let response: any[] = await queryApi.collectRows(fluxQuery);
    if (response.length === 0) {
      console.log('No data present in DB to check');
      return;
    }
    let dt = moment((<any>response[0])['_time']).tz(config.tz);
    // while (dt <= moment().tz(config.tz)) {
    //   await bot.load(dt.format(dateFormat));
    //   dt.add(1, 'days');
    // }

    console.log(
      `Starting integrity check back from ${dt
        .clone()
        .subtract(1, 'weeks')
        .add(1, 'day')
        .format(dateFormat)}`
    );

    let weeksBack = 1;
    let hasNext = true;
    // let zeroValues = 0;
    const dbResult = new Map<string, number>();

    while (hasNext) {
      // Check data in weekly chunks and compare it data
      const { start, stop, format } = getDatetimeRange(
        weeksBack,
        DateTime.fromJSDate(dt.toDate()),
        config.tz
      );

      fluxQuery = `
        from(bucket: "${config.influxBucket}")
          |> range(start: ${start}, stop: ${stop})
          |> filter(fn: (r) =>  r._measurement == "meteredValues" and r._field == "value")
          |> aggregateWindow(every: 15m, offset: 1ns, fn: mean)
      `;
      // console.log(fluxQuery);
      response = await queryApi.collectRows(fluxQuery);
      // console.log({
      //   response: response.map(
      //     (r: any) =>
      //       `${DateTime.fromJSDate(new Date(r._time))
      //         .toUTC()
      //         .toFormat(format)}: ${r._value}`
      //   ),
      // });
      response.pop(); // Delete last item since it's empty, not sure how the query would be correct
      response.forEach((r: any) => {
        const key = DateTime.fromJSDate(new Date(r._time))
          .toUTC()
          .toFormat(format);
        dbResult.set(key, Number(r._value));
      });

      if (dbResult.size === 0) {
        hasNext = false;
        console.log('No data in DB to check');
        continue;
      }

      for (let i = 0; i < 7; i++) {
        const day = moment
          .tz(stop, config.tz)
          .subtract(i + 1, 'days')
          .format(dateFormat);

        console.log('Testing integrity on ' + day);
        let data: Point[] | null = null;
        let failedAttempts = 0;

        while (failedAttempts <= maxFailedAttempts && data == null) {
          if (failedAttempts > 0) {
            console.log(`Retrying for ${day} ...`);
          }
          await sleep(failedAttempts > 0 ? 5000 : 300); // Avoid rate limiting
          try {
            data = await bot.fetch(day);
            if (data == null) {
              failedAttempts++;
            } else {
              failedAttempts = 0;
            }
          } catch {
            failedAttempts++;
          }
        }
        let hasErrors = false;

        const meteredValues = data?.filter(
          (row) => (<any>row).name === 'meteredValues'
        );
        meteredValues?.forEach((row) => {
          const key = DateTime.fromJSDate(new Date((<any>row).time.toString()))
            .toUTC()
            .toFormat(format);
          // console.log(key + ': ', res.get(key));
          // if (dbResult.get(key)) {
          //   console.log(
          //     `Matched - ${key} = ${dbResult.get(key)} vs. ${Number(
          //       row.fields.value
          //     )}`
          //   );
          // }
          const dbVal = ('' + dbResult.get(key)).trim();
          const webVal = ('' + row.fields.value).trim();
          if (dbResult.has(key)) {
            if (dbVal != webVal) {
              console.warn(
                `Mismatch DB/web on ${key}:\t${dbVal}\tvs.\t${webVal}`
              );
              hasErrors ||= true;
            }
          } else {
            console.log(`${key} not found in DB`);
          }
        });

        if (!hasErrors) {
          console.log('Everything is OK on ' + day);
        }

        if (!meteredValues?.length) {
          console.warn(`No data to check against DB on ${day}`);
        }
      }

      weeksBack++;
      hasNext = response.length > 0;

      if (
        typeof limitDaysBack !== 'undefined' &&
        weeksBack * 7 >= limitDaysBack
      ) {
        hasNext = false;
      }
    }
  } catch (err) {
    console.error((<Error>err).message);
  }
}

//#region Main
async function main() {
  try {
    const program = new Command();
    program
      .option('-m, --migrate', 'Migrate old measurement data into DB', false)
      .option(
        '-l, --limit <number>',
        'Limit migration to number of days (default: migration goes back until no data is present)'
      )
      .option('-c, --config <path>', 'Path to config file')
      .option('-d, --debug', 'Enable debug logging', false)
      .option('--doctor', 'Check measurements integrity')
      .option(
        '--continue-migration',
        'Continues migration from furthest measurement in the past'
      )
      .parse();

    const options = program.opts();

    if (options.config) {
      dotenv.config({ path: options.config });
      console.debug('Using config file: ' + options.config);
    }

    if (!options.debug) {
      console.debug = function () {};
    }

    const config: Config = {
      meterId: process.env.METER_ID!,
      tz: process.env.TZ!,
      influxBucket: process.env.INFLUX_BUCKET!,
      influxOrg: process.env.INFLUX_ORG!,
      influxToken: process.env.INFLUX_TOKEN!,
      influxUrl: process.env.INFLUX_URL!,
      username: process.env.USERNAME!,
      password: process.env.PASSWORD!,
      debug: options.debug,
    };

    const influxDb = new InfluxDB({
      url: config.influxUrl,
      token: config.influxToken,
    });

    const bot = new Bot(config, influxDb);

    for (const key of Object.keys(config)) {
      if (!config[key as keyof Config] && key !== 'debug') {
        throw new Error(
          `Missing environment variable ${key
            .replace(/[A-Z]/g, (letter) => `_${letter}`)
            .toUpperCase()}`
        );
      }
    }

    if (options.migrate) {
      await migrate({ bot, config, limitDaysBack: options.limit ?? undefined });
    } else if (options.doctor) {
      await doctor({
        bot,
        config,
        influxDb,
        limitDaysBack: options.limit ?? undefined,
      });
    } else if (options.continueMigration) {
      await continueMigration({ bot, config, influxDb });
    } else {
      await update({ bot, config, influxDb });
    }

    process.exit(0);
  } catch (err) {
    console.error((<Error>err).message);
    process.exit(1);
  }
}
//#endregion

main();
