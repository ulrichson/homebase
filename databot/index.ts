#!/usr/bin/env node

import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { Command } from 'commander';
import * as dotenv from 'dotenv';
import moment from 'moment-timezone';
import fs from 'node:fs';
import puppeteer, { Browser, Page } from 'puppeteer';

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
}

interface TableRow {
  [header: string]: number | Date | string | null;
}

interface TableData {
  headers: string[];
  rows: TableRow[];
}

class Bot {
  public readonly ready: Promise<void>;
  private browser?: Browser;
  private page?: Page;

  constructor(private config: Config, private influxDb: InfluxDB) {
    this.ready = new Promise(async (resolve, reject) => {
      try {
        await this.init();
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  private async init() {
    this.browser = isDocker()
      ? await puppeteer.launch({
          executablePath: '/usr/bin/chromium',
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        })
      : await puppeteer.launch({ headless: false });
    this.page = await this.browser.newPage();

    this.page.on('console', (msg) =>
      console.debug('BROWSER DEBUG: ', msg.text())
    );
  }

  /**
   * Loads the consumption data for the given day
   * @param day - Date with format DD.MM.YYYY
   *
   * @returns Whether the data was loaded successfully
   */
  async load(day: string) {
    if (!this.page || !this.browser) {
      throw new Error('Not initialized');
    }

    console.debug('Navigate to consumption page');
    await this.page.goto(
      'https://www.linznetz.at/portal/start.app?id=8&nav=/de_1/linz_netz_website/online_services/serviceportal/meine_verbraeuche/verbrauchsdateninformation/verbrauchsdateninformation.nav.xhtml',
      {
        waitUntil: 'domcontentloaded',
      }
    );

    console.debug('Select "Viertelstundenwerte"');
    await this.page.click(
      'label[for="myForm1\\:j_idt1247\\:grid_eval\\:selectedClass\\:1"]'
    );
    await this.page.waitForSelector(
      'label[for="myForm1\\:j_idt1270\\:j_idt1275\\:selectedClass\\:0"'
    );

    // For some reason selecting the radio button does not work before date selection
    console.debug('Select "Energiemenge in kWh"');
    await this.page.click(
      'label[for="myForm1\\:j_idt1270\\:j_idt1275\\:selectedClass\\:0"]'
    );

    console.debug('Enter date range');
    const input = await this.page.$('#myForm1\\:calendarFromRegion');
    await input?.click({ clickCount: 2 });
    await input?.type(day);
    await this.page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 500));

    const fromValue = await this.page.$eval(
      '#myForm1\\:calendarFromRegion',
      (el) => (<any>el).value
    );
    const toValue = await this.page.$eval(
      '#myForm1\\:calendarToRegion',
      (el) => (<any>el).value
    );

    console.debug('Date input from value: ' + fromValue);
    console.debug('Date input to value: ' + toValue);

    if (day !== fromValue || day !== toValue) {
      throw new Error('Date input not set correctly');
    }

    try {
      const meteredValuesDataTable =
        await this.downloadResult(/*'Energiemenge'*/);

      console.debug('Select "Leistung in kW"');
      this.page.click(
        'label[for="myForm1\\:j_idt1270\\:j_idt1275\\:selectedClass\\:1'
      );
      await this.page.waitForResponse((response) => {
        return response.request().url().includes('/consumption.jsf');
      });
      console.debug('Reset pagination');
      this.page.click('.ui-paginator-pages > .ui-paginator-page:first-child');
      await this.page.waitForResponse((response) => {
        return response.request().url().includes('/consumption.jsf');
      });

      const meteredPeakDemandsDataTable =
        await this.downloadResult(/*'Leistung'*/);

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
      try {
        await this.page.screenshot({
          path: `/app/export/.error_${moment().format(
            'YYYY-MM-DD_hh-mm-ss'
          )}_${new Date().getTime()}}.png`,
        });
      } catch {}
      return false;
    }

    return true;
  }

  /**
   * Login
   */
  async login() {
    if (!this.page || !this.browser) {
      throw new Error('Not initialized');
    }

    console.debug('Navigate to login');
    await this.page.goto('https://www.linznetz.at', {
      waitUntil: 'domcontentloaded',
    });
    await this.page.click('#loginFormTemplateHeader\\:doLogin');
    await this.page.waitForNavigation({
      waitUntil: 'domcontentloaded',
    });

    console.debug('Enter credentials');
    await this.page.type('#username', this.config.username);
    await this.page.type('#password', this.config.password);

    await this.page.evaluate(
      (form) => form?.submit(),
      await this.page.$('form[name="loginForm"]')
    );
    await this.page.waitForNavigation();

    console.info('Login successful');
  }

  /**
   * Logout
   */
  async logout() {
    if (!this.page || !this.browser) {
      throw new Error('Not initialized');
    }

    console.debug('Navigate to logout');
    await this.page.goto(
      'https://sso.linznetz.at/auth/realms/netzsso/protocol/openid-connect/logout?redirect_uri=https%3A%2F%2Fwww.linznetz.at%2Fportal%2Fde%2Fhome%2Fonline_services%2Fserviceportal',
      {
        waitUntil: 'domcontentloaded',
      }
    );

    await this.browser.close();

    console.info('Logout successful');
  }

  private async downloadResult(/*expect: 'Energiemenge' | 'Leistung'*/) {
    if (!this.page) {
      throw new Error('Not initialized');
    }

    console.debug('Click "Anzeigen"');
    await this.page.click('#myForm1\\:btnIdA1'); // Button "Anzeigen"

    console.debug('Wait for result');
    // await this.page.waitForFunction(
    //   `document.querySelector("body").innerText.includes("${expect}")`
    // );
    // await this.page.waitForNetworkIdle();
    // await this.page.waitForResponse((response) => {
    //   return response.request().url().includes('/consumption.jsf');
    // });
    await new Promise((r) => setTimeout(r, 500));

    let hasNext = true;
    const tableData: TableData = { headers: [], rows: [] };

    while (hasNext) {
      const pageTableData = await this.tableToJson(
        '#myForm1\\:consumptionsTable table'
      );

      tableData.headers = pageTableData.headers;
      tableData.rows.push(...pageTableData.rows);

      const nextButton = await this.page.$(
        '#myForm1\\:consumptionsTable_paginator_bottom a.ui-paginator-next'
      );

      hasNext =
        !(await this.page.evaluate(
          (el) => el?.classList.contains('ui-state-disabled'),
          nextButton
        )) ?? false;
      if (hasNext) {
        await nextButton?.click();
        await this.page.waitForResponse((response) => {
          return response.request().url().includes('/consumption.jsf');
        });
      }
    }

    console.debug(`Received ${tableData.rows.length} data rows`);

    return tableData;
  }

  private async tableToJson(tableSelector: string): Promise<TableData> {
    if (!this.page) {
      throw new Error('Not initialized');
    }

    const table = (await this.page.$$(tableSelector))[0];
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
  async function migrate({ bot, config }: { bot: Bot; config: Config }) {
    let deltaDays = 1;
    let hasNext = true;
    const maxFailedAttempts = 3;
    let failedAttempts = 0;
    let allowedEmptyDays = 7;
    console.debug('Starting migrating old measurements');
    while (hasNext) {
      const day = moment()
        .tz(config.tz)
        .subtract(deltaDays, 'days')
        .format(dateFormat);
      try {
        if (!(await bot.load(day))) {
          allowedEmptyDays -= 1;
        }
        deltaDays += 1;
      } catch (err) {
        failedAttempts += 1;
        console.error(err);
      }

      if (failedAttempts >= maxFailedAttempts || allowedEmptyDays < 0) {
        console.debug('Stopping migration since no more data is present');
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
    };

    const influxDb = new InfluxDB({
      url: config.influxUrl,
      token: config.influxToken,
    });

    const bot = new Bot(config, influxDb);
    await bot.ready;

    for (const key of Object.keys(config)) {
      if (!config[key as keyof Config]) {
        throw new Error(
          `Missing environment variable ${key
            .replace(/[A-Z]/g, (letter) => `_${letter}`)
            .toUpperCase()}`
        );
      }
    }

    await bot.login();

    if (options.migrate) {
      await migrate({ bot, config });
    } else {
      await update({ bot, config, influxDb });
    }

    await bot.logout();

    process.exit(0);
  } catch (err) {
    console.error((<Error>err).message);
    process.exit(1);
  }
}

main();
