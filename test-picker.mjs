import { chromium } from "@playwright/browser";

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();

console.log("🎮 Testing Game Picker UI\n");

// Navigate to picker
console.log("1. Opening picker at http://localhost:5174...");
await page.goto("http://localhost:5174");
await page.waitForSelector("h1", { timeout: 5000 });
console.log("   ✓ Picker loaded\n");

// Check page title
const title = await page.title();
console.log(`2. Page title: "${title}"`);

// Test search
console.log("\n3. Testing search functionality...");
const searchInput = await page.locator("#searchInput");
await searchInput.focus();
await searchInput.type("Spider-Man");
await page.waitForSelector(".result-item", { timeout: 5000 });
const results = await page.locator(".result-item").count();
console.log(`   ✓ Found ${results} search results for "Spider-Man"\n`);

// Test selecting a game
console.log("4. Testing game selection...");
const firstCheckbox = await page.locator(".result-item input[type=checkbox]").first();
await firstCheckbox.check();
await page.waitForSelector(".queue-item", { timeout: 2000 });
const queueItems = await page.locator(".queue-item").count();
console.log(`   ✓ Selected a game. Queue now has ${queueItems} item(s)\n`);

// Test bulk apply
console.log("5. Testing bulk apply (Platform/Mode)...");
const platformSelect = await page.locator("#bulkPlatform");
await platformSelect.selectOption("PS4");
const modeSelect = await page.locator("#bulkMode");
await modeSelect.selectOption("raw");
const applyBtn = await page.locator("#bulkApply");
await applyBtn.click();
await page.waitForTimeout(500);
console.log("   ✓ Applied PS4 / Raw mode\n");

// Check the games table
console.log("6. Checking games table...");
const tableRows = await page.locator("table tbody tr").count();
console.log(`   ✓ Games table has ${tableRows} row(s)\n`);

// Take screenshot
console.log("7. Taking screenshot...");
await page.screenshot({ path: "picker-ui-test.png" });
console.log("   ✓ Screenshot saved to picker-ui-test.png\n");

// Close browser
await browser.close();
console.log("✅ All tests passed!");
