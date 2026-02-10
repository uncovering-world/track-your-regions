import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 1400, height: 900 });

await page.goto('http://localhost:5174/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2000);

// Switch to Wikivoyage
await page.locator('[id="world-view-select"]').click();
await page.waitForTimeout(500);
await page.locator('li[role="option"]:has-text("Wikivoyage")').click();
await page.waitForTimeout(2000);

// Go to Oceania
await page.evaluate(() => {
  const items = document.querySelectorAll('[role="button"]');
  for (const item of items) {
    if (item.textContent && item.textContent.includes('Oceania')) {
      item.click();
      break;
    }
  }
});
await page.waitForTimeout(3000);

await page.screenshot({ path: '/tmp/islands-oceania.png' });
console.log('Saved: /tmp/islands-oceania.png');

// Click on Polynesia
await page.evaluate(() => {
  const items = document.querySelectorAll('[role="button"]');
  for (const item of items) {
    if (item.textContent && item.textContent.includes('Polynesia')) {
      item.click();
      break;
    }
  }
});
await page.waitForTimeout(3000);

await page.screenshot({ path: '/tmp/islands-polynesia.png' });
console.log('Saved: /tmp/islands-polynesia.png');

// Go back to Oceania and click Micronesia
await page.goBack();
await page.waitForTimeout(2000);
await page.evaluate(() => {
  const items = document.querySelectorAll('[role="button"]');
  for (const item of items) {
    if (item.textContent && item.textContent.includes('Micronesia')) {
      item.click();
      break;
    }
  }
});
await page.waitForTimeout(3000);

await page.screenshot({ path: '/tmp/islands-micronesia.png' });
console.log('Saved: /tmp/islands-micronesia.png');

await browser.close();
