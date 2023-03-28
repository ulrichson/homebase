#!/usr/bin/env node

import { Command } from 'commander';
import * as dotenv from 'dotenv';
import moment from 'moment-timezone';
import puppeteer, { Browser, Page } from 'puppeteer';

const dateFormat = 'DD.MM.YYYY';

interface Config {
  meterId: string;
  tz: string;
  bucket: string;
  org: string;
  token: string;
  url: string;
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

  constructor(private config: Config) {
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
    this.browser = await puppeteer.launch();
    this.page = await this.browser.newPage();
  }

  /**
   * Loads the consumption data for the given day
   * @param day - Date with format DD.MM.YYYY
   */
  async load(day: string) {
    if (!this.page || !this.browser) {
      throw new Error('Not initialized');
    }

    console.debug('Navigate to consumption page');
    await this.page.goto(
      'https://www.linznetz.at/portal/start.app?id=8&nav=/de_1/linz_netz_website/online_services/serviceportal/meine_verbraeuche/verbrauchsdateninformation/verbrauchsdateninformation.nav.xhtml'
    );

    console.debug('Select "Viertelstundenwerte"');
    await this.page.click(
      'label[for="myForm1:j_idt1247:grid_eval:selectedClass:1"]'
    );
    await this.page.waitForSelector(
      'label[for="myForm1:j_idt1270:j_idt1275:selectedClass:0"]'
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
      console.debug('Select "Energiemenge in kWh"');
      // No need to click, it's pre-selected
      // page.click('label[for="myForm1:j_idt1270:j_idt1275:selectedClass:0"]');
      await this.downloadResult();

      console.debug('Select "Leistung in kW"');
      this.page.click('label[for="myForm1:j_idt1270:j_idt1275:selectedClass:1');
      await this.page.waitForResponse((response) => {
        return response.request().url().includes('/consumption.jsf');
      });
      await this.downloadResult();
    } catch {
      console.warn(`No measurement data for ${day}`);
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
    await this.page.goto('https://www.linznetz.at');
    await this.page.click('#loginFormTemplateHeader\\:doLogin');
    await this.page.waitForNavigation();

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

    console.debug('Logout');
    await this.page.goto(
      'https://sso.linznetz.at/auth/realms/netzsso/protocol/openid-connect/logout?redirect_uri=https%3A%2F%2Fwww.linznetz.at%2Fportal%2Fde%2Fhome%2Fonline_services%2Fserviceportal'
    );

    await this.browser.close();

    console.info('Logout successful');
  }

  private async downloadResult() {
    if (!this.page) {
      throw new Error('Not initialized');
    }

    console.debug('Click "Anzeigen"');
    await this.page.waitForSelector('#myForm1\\:btnIdA1', { visible: true });
    await this.page.click('#myForm1\\:btnIdA1'); // Button "Anzeigen"

    console.debug('Wait for result');
    await this.page.waitForResponse((response) => {
      return response.request().url().includes('/consumption.jsf');
    });

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
        await this.page.waitForNetworkIdle();
      }
    }

    console.debug(`Received ${tableData.rows.length} data rows`);
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
          const date = moment(tds[index], 'DD.MM.YYYY hh:mm').toDate();
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

  try {
    const program = new Command();
    program
      .option('-m, --migrate', 'Migrate old measurement data into DB', false)
      .option('-c, --config <path>', 'Path to config file')
      .parse();

    const options = program.opts();

    const path = options.config;

    if (path) {
      dotenv.config({ path });
      console.debug('Using config file: ' + path);
    }

    const config: Config = {
      meterId: process.env.METER_ID!,
      tz: process.env.TZ!,
      bucket: process.env.INFLUX_BUCKET!,
      org: process.env.INFLUX_ORG!,
      token: process.env.INFLUX_TOKEN!,
      url: process.env.INFLUX_URL!,
      username: process.env.USERNAME!,
      password: process.env.PASSWORD!,
    };

    const bot = new Bot(config);
    await bot.ready;

    // if (
    //   !meterId ||
    //   !tz ||
    //   !bucket ||
    //   !org ||
    //   !token ||
    //   !url ||
    //   !username ||
    //   !password
    // ) {
    //   throw new Error('Missing environment variables');
    // }

    await bot.login();

    if (options.migrate) {
      await migrate({ bot, config });
    } else {
      console.debug('TODO');
      // await bot.load('06.03.2023');
    }

    await bot.logout();

    process.exit(0);
  } catch (err) {
    console.error((<Error>err).message);
    process.exit(1);
  }
}

main();
