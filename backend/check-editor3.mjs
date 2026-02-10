import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 1400, height: 900 });

page.on('console', msg => {
  const text = msg.text();
  console.log('CONSOLE:', text);
});

await page.goto('http://localhost:5174/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2000);

// Switch to Wikivoyage using keyboard navigation
const worldViewSelect = await page.locator('[id="world-view-select"]');
await worldViewSelect.click();
await page.waitForTimeout(500);

// Click on Wikivoyage option
await page.locator('li[role="option"]:has-text("Wikivoyage")').click();
await page.waitForTimeout(2000);

// Click edit button 
const editBtn = page.locator('button').filter({ has: page.locator('svg') }).nth(1);
await editBtn.click();
await page.waitForTimeout(2000);

// Screenshot the editor
await page.screenshot({ path: '/tmp/editor3.png' });

// Now click on Oceania in the list using evaluate to avoid pointer event issues
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

await page.screenshot({ path: '/tmp/editor-oceania3.png' });
console.log('Screenshots saved');

await browser.close();
