import chromium from '@sparticuz/chromium';
import path from 'path';
import nodemailer from 'nodemailer';
import puppeteer from 'puppeteer-core';

const LOGIN_URL = 'https://demo-nova.singleinterface.com/login';
const DASHBOARD_URL = 'https://demo-nova.singleinterface.com/dashboard-insight';

const WIDGET_TITLES = [
  'Presence AI',
  'Competitor AI',
  'Reviews AI',
  'Pages AI',
  'Audience AI',
  'Tasks AI'
];

const INVALID_PATTERNS = [
  'no data',
  'no-data',
  'error loading',
  'loading',
  'not available',
  'n/a',
  '--',
  'na'
];

const TIME_ZONE = (process.env.TIME_ZONE || 'Asia/Kolkata').trim();
const ALERTS_ENABLED =
  (process.env.ALERTS_ENABLED ?? 'true').toLowerCase() === 'true';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  console.log('Received widget check request.');

  const checkedAt = formatTimestamp(new Date());
  const config = validateEnvironment();
  let browser;

  try {
    browser = await launchBrowser();
    console.log('Browser launched successfully.');
    const page = await browser.newPage();
    console.log('New page opened.');

    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('Login page loaded.');
    await page.waitForSelector('input[placeholder="Enter your email"]', { timeout: 30000 });
    await page.waitForSelector('input[placeholder="Enter your password"]', { timeout: 30000 });

    await page.type('input[placeholder="Enter your email"]', config.loginEmail, { delay: 20 });
    await page.type('input[placeholder="Enter your password"]', config.loginPass, { delay: 20 });

    await clickLoginButton(page);
    await page
      .waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 })
      .catch(() => null);

    // Ensure we land on the right dashboard even if navigation changes.
    if (!page.url().includes('/dashboard-insight')) {
      await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    }
    console.log('Dashboard page ready.');

    await page.waitForSelector('.insights-card', { timeout: 60000 });
    console.log('Insights cards detected.');
    await page.waitForFunction(
      titles => titles.every(title => {
        const heading = Array.from(document.querySelectorAll('h3')).find(
          el => el.textContent.trim() === title
        );
        return Boolean(heading && heading.closest('.insights-card'));
      }),
      { timeout: 60000 },
      WIDGET_TITLES
    );
    console.log('All widget headings found.');

    const widgetResults = await page.evaluate(
      (titles, invalidPatterns) => {
        const normalize = value => value.trim().toLowerCase();
        const results = [];

        for (const title of titles) {
          const heading = Array.from(document.querySelectorAll('h3')).find(
            el => el.textContent.trim() === title
          );

          if (!heading) {
            results.push({
              title,
              status: 'missing',
              reason: 'Widget title not found on the page.'
            });
            continue;
          }

          const card = heading.closest('.insights-card');

          if (!card) {
            results.push({
              title,
              status: 'missing',
              reason: 'Widget card container not found.'
            });
            continue;
          }

          const textBlocks = card.innerText
            .split('\n')
            .map(block => block.trim())
            .filter(Boolean);

          const dataBlocks = textBlocks.filter(
            block => normalize(block) !== normalize(title)
          );

          if (dataBlocks.length === 0) {
            results.push({
              title,
              status: 'invalid',
              reason: 'Widget card rendered but data section is empty.'
            });
            continue;
          }

          const hasMeaningfulData = dataBlocks.some(block => {
            const normalized = normalize(block);
            if (!normalized) return false;
            if (invalidPatterns.includes(normalized)) return false;
            if (/^0+(\.0+)?%?$/.test(normalized)) return false;
            if (/^0+\s+\w+/.test(normalized)) return false;
            return normalized.length > 1;
          });

          if (!hasMeaningfulData) {
            results.push({
              title,
              status: 'invalid',
              reason: 'Widget card rendered only contains empty or zero values.'
            });
            continue;
          }

          results.push({
            title,
            status: 'ok',
            sample: dataBlocks.slice(0, 5)
          });
        }

        return results;
      },
      WIDGET_TITLES,
      INVALID_PATTERNS
    );

    const failures = widgetResults.filter(result => result.status !== 'ok');

    if (failures.length > 0) {
      const failureSummary = failures
        .map(result => `${result.title}: ${result.reason}`)
        .join('; ');

      console.error(`[✖] Widget issues detected — checked at ${checkedAt}: ${failureSummary}`);
      await sendAlertEmail(failures, checkedAt).catch(emailError => {
        console.error('Failed to send alert email:', emailError);
      });
      console.log('Alert email attempt completed.');

      return res.status(200).json({
        status: 'alert',
        checkedAt,
        failures
      });
    }

    console.log(`[✔] All 6 widgets and their data loaded successfully — checked at ${checkedAt}`);

    return res.status(200).json({
      status: 'ok',
      checkedAt,
      widgets: widgetResults
    });
  } catch (error) {
    console.error('Widget check failed: ', error);

    await sendAlertEmail(
      [
        {
          title: 'General',
          status: 'error',
          reason: `Script error: ${error.message}`
        }
      ],
      checkedAt,
      error.stack
    ).catch(emailError => {
      console.error('Failed to send alert email:', emailError);
    });

    return res.status(500).json({
      status: 'error',
      checkedAt,
      message: error.message
    });
  } finally {
    if (browser) {
      await browser.close();
      console.log('Browser closed.');
    }
  }
}

async function launchBrowser() {
  if (chromium.setHeadlessMode) {
    chromium.setHeadlessMode('new');
  }

  if (chromium.setGraphicsMode) {
    chromium.setGraphicsMode(false);
  }

  const customExecutable = process.env.PUPPETEER_EXECUTABLE_PATH;
  const computedExecutable = await chromium.executablePath();

  console.log('Custom executable path', customExecutable || 'not provided');
  console.log('Computed executable path', computedExecutable || 'not available');

  const executablePath = customExecutable || computedExecutable;

  if (!executablePath) {
    throw new Error(
      'Unable to find a Chromium executable. Set PUPPETEER_EXECUTABLE_PATH for local runs.'
    );
  }

  const executableDir = path.dirname(executablePath);
  const libraryDirs = [
    executableDir,
    path.join(executableDir, 'lib'),
    path.join(executableDir, 'swiftshader')
  ];

  process.env.LD_LIBRARY_PATH = [
    ...libraryDirs,
    process.env.LD_LIBRARY_PATH
  ]
    .filter(Boolean)
    .join(':');

  console.log('LD_LIBRARY_PATH set to', process.env.LD_LIBRARY_PATH);

  const usingCustomExecutable = Boolean(process.env.PUPPETEER_EXECUTABLE_PATH);
  const launchArgs = usingCustomExecutable
    ? [
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--no-zygote'
      ]
    : chromium.args;

  const headless = usingCustomExecutable
    ? (process.env.PUPPETEER_HEADLESS ?? 'new')
    : typeof chromium.headless === 'boolean'
    ? chromium.headless
    : 'new';

  return puppeteer.launch({
    args: launchArgs,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless,
    ignoreHTTPSErrors: true
  });
}

function validateEnvironment() {
  const required = ['LOGIN_EMAIL', 'LOGIN_PASS'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }

  return {
    loginEmail: process.env.LOGIN_EMAIL,
    loginPass: process.env.LOGIN_PASS
  };
}

async function sendAlertEmail(failures, checkedAt, extraDetails = '') {
  const { EMAIL_USER, EMAIL_PASS } = process.env;

  if (!ALERTS_ENABLED) {
    console.log('Alert emails disabled via ALERTS_ENABLED environment variable.');
    return;
  }

  if (!EMAIL_USER || !EMAIL_PASS) {
    console.warn('Email credentials missing; skipping alert email.');
    return;
  }

  const recipients = (process.env.ALERT_RECIPIENTS || EMAIL_USER)
    .split(',')
    .map(address => address.trim())
    .filter(Boolean);

  if (recipients.length === 0) {
    console.warn('No alert recipients configured; skipping alert email.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS
    }
  });

  const subject = '⚠️ Demo Nova Widget Data Missing on Insights AI Dashboard';
  const failureLines = failures
    .map(result => `• ${result.title} — ${result.reason}`)
    .join('\n');

  const body = [
    'The automated Insights AI widget check detected an issue.',
    '',
    `Checked at: ${checkedAt}`,
    '',
    failureLines,
    '',
    extraDetails ? `Details:\n${extraDetails}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: recipients,
    subject,
    text: body
  });
}

async function clickLoginButton(page) {
  const submitSelector = 'button[type="submit"]';
  const submitButton = await page.$(submitSelector);

  if (submitButton) {
    await submitButton.click();
    return;
  }

  const [buttonByText] = await page.$x("//button[contains(., 'Sign In')]");

  if (buttonByText) {
    await buttonByText.click();
    return;
  }

  throw new Error('Sign in button not found on the login page.');
}

function formatTimestamp(date) {
  const options = {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: TIME_ZONE
  };

  try {
    return new Intl.DateTimeFormat('en-IN', options).format(date);
  } catch (error) {
    console.warn(
      `Failed to format timestamp with time zone "${TIME_ZONE}": ${error.message}`
    );

    const offsetMinutes = resolveTimeZoneOffset(TIME_ZONE);

    if (offsetMinutes !== null) {
      return formatWithOffset(date, offsetMinutes);
    }

    return date.toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }
}

function resolveTimeZoneOffset(timeZone) {
  const trimmed = timeZone.trim();

  const offsetMatch = /^([+-]?)(\d{2}):?(\d{2})$/.exec(trimmed);
  if (offsetMatch) {
    const sign = offsetMatch[1] === '-' ? -1 : 1;
    const hours = parseInt(offsetMatch[2], 10);
    const minutes = parseInt(offsetMatch[3], 10);
    return sign * (hours * 60 + minutes);
  }

  const lowerCaseZone = trimmed.toLowerCase();
  if (lowerCaseZone === 'asia/kolkata' || lowerCaseZone === 'asia/calcutta') {
    return 330;
  }

  return null;
}

function formatWithOffset(date, offsetMinutes) {
  const utcMillis = date.getTime();
  const shifted = utcMillis + offsetMinutes * 60_000;

  const totalMinutes = Math.floor((shifted / 60_000) % (24 * 60));
  const normalizedMinutes =
    totalMinutes >= 0 ? totalMinutes : totalMinutes + 24 * 60;

  const hours = Math.floor(normalizedMinutes / 60);
  const minutes = normalizedMinutes % 60;
  const period = hours >= 12 ? 'pm' : 'am';
  const hour12 = ((hours + 11) % 12) + 1;

  return `${hour12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

