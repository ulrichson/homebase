#!/usr/bin/env node

import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { Command } from 'commander';
import * as dotenv from 'dotenv';
import moment from 'moment-timezone';
import fs from 'node:fs';
import puppeteer, { Page } from 'puppeteer';

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
const dateFormat = 'DD.MM.YYYY';

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
   * Loads the consumption data for the given day
   * @param day - Date with format DD.MM.YYYY
   *
   * @returns Whether the data was loaded successfully
   */
  async load(day: string): Promise<number> {
    let ret = 0;
    const browser = isDocker()
      ? await puppeteer.launch({
          executablePath: '/usr/bin/chromium',
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        })
      : await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    page.on('console', (msg) => console.debug('BROWSER DEBUG: ', msg.text()));

    console.debug('Navigate to login');
    await page.goto('https://www.linznetz.at', {
      waitUntil: 'domcontentloaded',
    });
    await page.click('#loginFormTemplateHeader\\:doLogin');
    await page.waitForNavigation({
      waitUntil: 'domcontentloaded',
    });

    console.debug('Enter credentials');
    await page.type('#username', this.config.username);
    await page.type('#password', this.config.password);

    await page.evaluate(
      (form) => form?.submit(),
      await page.$('form[name="loginForm"]')
    );
    await page.waitForNavigation();

    console.info('Login successful');

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
      page.click('.ui-paginator-first');
      await page.waitForResponse((response) => {
        return response.request().url().includes('/consumption.jsf');
      });

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
      ret = data.length;
      const writeApi = this.influxDb.getWriteApi(
        this.config.influxOrg,
        this.config.influxBucket,
        's'
      );
      // console.log(
      //   meteredValuesDataTable.headers,
      //   meteredPeakDemandsDataTable.headers
      // );
      writeApi.writePoints(data);
      writeApi.close();
      console.info(`Stored measurements in DB for ${day}`);
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
      return 0;
    }

    try {
      console.debug('Navigate to logout');
      await page.goto(
        'https://sso.linznetz.at/auth/realms/netzsso/protocol/openid-connect/logout?redirect_uri=https%3A%2F%2Fwww.linznetz.at%2Fportal%2Fde%2Fhome%2Fonline_services%2Fserviceportal',
        {
          waitUntil: 'domcontentloaded',
        }
      );
      await browser.close();

      console.info('Logout successful');
    } catch (err) {
      console.warn(`Cannot logout`);
      console.debug((<Error>err).stack);
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

async function main() {
  async function migrate({
    bot,
    config,
    limitDaysBack,
  }: {
    bot: Bot;
    config: Config;
    limitDaysBack?: number;
  }) {
    let deltaDays = 1;
    let hasNext = true;
    const maxFailedAttempts = 3;
    let failedAttempts = 0;
    let allowedIncompleteDays = 7;
    console.info(
      'Starting migrating old measurements' +
        (typeof limitDaysBack !== 'undefined'
          ? ` of last ${limitDaysBack} day${limitDaysBack !== 1 ? 's' : ''}`
          : '')
    );
    while (hasNext) {
      const day = moment()
        .tz(config.tz)
        .subtract(deltaDays, 'days')
        .format(dateFormat);
      try {
        if (
          (await bot.load(day)) !==
          24 /* hours a day */ * 4 /* quarter hours */ * 2 /* data rows */
        ) {
          allowedIncompleteDays -= 1;
        }
        deltaDays += 1;
      } catch (err) {
        failedAttempts += 1;
        console.error(err);
      }

      if (failedAttempts >= maxFailedAttempts || allowedIncompleteDays < 0) {
        console.debug('Stopping migration since no more data is present');
        hasNext = false;
      }

      if (typeof limitDaysBack !== 'undefined' && deltaDays > limitDaysBack) {
        hasNext = false;
      }
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
    try {
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
        let dt = moment((<any>response[0])['_time']).tz(config.tz);
        while (dt <= moment().tz(config.tz)) {
          await bot.load(dt.format(dateFormat));
          dt.add(1, 'days');
        }
      }
    } catch (err) {
      console.error((<Error>err).message);
    }
  }

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
    } else {
      await update({ bot, config, influxDb });
    }

    process.exit(0);
  } catch (err) {
    console.error((<Error>err).message);
    process.exit(1);
  }
}

main();
