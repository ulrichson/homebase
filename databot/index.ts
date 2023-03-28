#!/usr/bin/env node

import { Command } from 'commander';
import moment from 'moment';
import puppeteer, { Page } from 'puppeteer';

interface TableRow {
  [header: string]: number | Date | string | null;
}

interface TableData {
  headers: string[];
  rows: TableRow[];
}

const tableToJson = async (
  page: Page,
  tableSelector: string
): Promise<TableData> => {
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
  for (let tr of trs) {
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
};

async function load() {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  console.log('Navigate to login');
  await page.goto('https://www.linznetz.at');
  await page.click('#loginFormTemplateHeader\\:doLogin');
  await page.waitForNavigation();

  console.log('Enter credentials');
  await page.type('#username', username);
  await page.type('#password', password);

  await page.evaluate(
    (form) => form?.submit(),
    await page.$('form[name="loginForm"]')
  );
  await page.waitForNavigation();

  console.log('Navigate to consumption page');
  await page.goto(
    'https://www.linznetz.at/portal/start.app?id=8&nav=/de_1/linz_netz_website/online_services/serviceportal/meine_verbraeuche/verbrauchsdateninformation/verbrauchsdateninformation.nav.xhtml'
  );

  console.log('Select "Viertelstundenwerte"');
  await page.click('label[for="myForm1:j_idt1247:grid_eval:selectedClass:1"]');
  await page.waitForSelector(
    'label[for="myForm1:j_idt1270:j_idt1275:selectedClass:0"]'
  );

  console.log('Enter date range');
  const input = await page.$('#myForm1\\:calendarFromRegion');
  await input?.click({ clickCount: 2 });
  await input?.type(date);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  console.log(
    'Date input from value: ' +
      (await page.$eval(
        '#myForm1\\:calendarFromRegion',
        (el) => (<any>el).value
      ))
  );
  console.log(
    'Date input to value: ' +
      (await page.$eval('#myForm1\\:calendarToRegion', (el) => (<any>el).value))
  );

  console.log('Select "Energiemenge in kWh"');
  // No need to click, it's pre-selected
  // page.click('label[for="myForm1:j_idt1270:j_idt1275:selectedClass:0"]');
  await downloadResult(page);

  console.log('Select "Leistung in kW"');
  page.click('label[for="myForm1:j_idt1270:j_idt1275:selectedClass:1');
  await page.waitForResponse((response) => {
    return response.request().url().includes('/consumption.jsf');
  });
  await downloadResult(page);

  console.log('Logout');
  await page.goto(
    'https://sso.linznetz.at/auth/realms/netzsso/protocol/openid-connect/logout?redirect_uri=https%3A%2F%2Fwww.linznetz.at%2Fportal%2Fde%2Fhome%2Fonline_services%2Fserviceportal'
  );

  await browser.close();
}

async function downloadResult(page: Page) {
  console.log('Click "Anzeigen"');
  await page.waitForSelector('#myForm1\\:btnIdA1', { visible: true });
  await page.click('#myForm1\\:btnIdA1'); // Button "Anzeigen"

  console.log('Wait for result');
  await page.waitForResponse((response) => {
    return response.request().url().includes('/consumption.jsf');
  });

  let hasNext = true;
  const tableData: TableData = { headers: [], rows: [] };
  while (hasNext) {
    const pageTableData = await tableToJson(
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
      await page.waitForNetworkIdle();
    }
  }

  console.log(`Received ${tableData.rows.length} data rows`);
}

const program = new Command();
program
  .option('-u, --username <username>', 'The username')
  .option('-p, --password <password>', 'The password')
  .option(
    '-d, --date <date>',
    'The date to fetch',
    moment().subtract(1, 'days').format('DD.MM.YYYY')
  )
  .parse();

const options = program.opts();

const username = options.username;
const password = options.password;
const date = options.date;

load();
