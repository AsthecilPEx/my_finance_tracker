import { _electron as electron } from 'playwright-core';
// End-to-end check that every text, number, date and search box on every screen and pop-up
// accepts typing. Runs the real Electron app. Usage: npm run build && node tests/e2e/inputs.e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-e2e-'));
const app = await electron.launch({ executablePath: require('electron'), args: [root, '--no-sandbox', `--user-data-dir=${userData}`] });
const win = await app.firstWindow();
await win.setViewportSize({ width: 1400, height: 950 });
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
const results = { ok: 0, fail: [] };

// Every visible text box / dropdown must be readable (not squeezed), normal height, and inside
// its pop-up. Catches layout bugs like an amount box squashed by a currency picker.
async function checkLayout(where, scope) {
  const problems = await win.evaluate((scope) => {
    const out = [];
    const modal = document.querySelector('.modal')?.getBoundingClientRect();
    for (const el of document.querySelectorAll(`${scope} input, ${scope} select, ${scope} textarea`)) {
      if (['checkbox', 'radio', 'range', 'file', 'hidden'].includes(el.type)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
      const name = el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.closest('label')?.querySelector('span')?.textContent || el.tagName;
      const minW = el.classList.contains('qty') ? 44 : 60;
      if (r.width < minW) out.push(`"${name}" is only ${Math.round(r.width)}px wide`);
      if (el.tagName !== 'TEXTAREA' && r.height > 56) out.push(`"${name}" is ${Math.round(r.height)}px tall`);
      if (modal && scope === '.modal' && (r.right > modal.right + 1 || r.left < modal.left - 1)) out.push(`"${name}" sticks out of the pop-up`);
    }
    return out;
  }, scope);
  for (const p of problems) results.fail.push(`${where} › layout: ${p}`);
}

async function checkInputs(where, scope = 'body') {
  await checkLayout(where, scope);
  const sel = `${scope} input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=hidden]):not([readonly]):not([disabled]), ${scope} textarea:not([readonly]):not([disabled])`;
  const n = await win.locator(sel).count();
  for (let i = 0; i < n; i++) {
    const el = win.locator(sel).nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const type = (await el.getAttribute('type')) || 'text';
    const label = (await el.getAttribute('placeholder')) || (await el.getAttribute('aria-label')) || (await el.evaluate((e) => e.closest('label')?.querySelector('span')?.textContent || e.name || '')) || `#${i}`;
    try {
      await el.scrollIntoViewIfNeeded();
      await el.click({ timeout: 3000 });
      let expected;
      if (type === 'date') {
        await el.fill('2026-10-15');
        expected = '2026-10-15';
      } else {
        await win.keyboard.press('Control+A');
        const text = type === 'number' ? '7' : 'Zq';
        await win.keyboard.type(text, { delay: 15 });
        expected = text;
      }
      const v = await el.inputValue().catch(() => null);
      if (v === null) { results.ok++; continue; } // element re-rendered away after typing (e.g. a toggle), typing worked
      if (v.toLowerCase().includes(expected.toLowerCase())) results.ok++;
      else results.fail.push(`${where} › "${label}" (${type}) → got "${v}"`);
    } catch (e) {
      results.fail.push(`${where} › "${label}" (${type}) → ${e.message.split('\n')[0]}`);
    }
  }
}
const nav = (label) => win.locator('.nav', { hasText: label }).click();
const closeModal = async () => { if (await win.locator('.modal').count()) { await win.keyboard.press('Escape'); await win.waitForTimeout(150); } };

// Onboarding (fresh install)
await win.waitForSelector('.onboard-card');
await checkInputs('Onboarding: You');
await win.getByText("Let's go →").click();
await checkInputs('Onboarding: Pay (salary)');
await win.getByText('Hourly rate').click(); await checkInputs('Onboarding: Pay (hourly)');
await win.getByText('I know my take-home').click(); await checkInputs('Onboarding: Pay (take-home)');
await win.getByText('Yearly salary').click();
await win.getByText('My pay changes each time').click(); await checkInputs('Onboarding: Pay (variable)');
await win.getByText('+ Add another income').click(); await checkInputs('Onboarding: second income');
await win.getByText('Tax code, pension & deductions').click().catch(() => {});
await win.getByText('+ Add deduction').click().catch(() => {});
await checkInputs('Onboarding: tax & deductions');
await win.getByText('Next →').click();
for (const b of ['🏠 Rent / mortgage', '⚡ Gas & electricity']) await win.getByText(b).click();
await checkInputs('Onboarding: Bills');
await win.getByText('Next →').click();
await checkInputs('Onboarding: Safety net');
await win.getByText('Next →').click();
await win.getByText('Open my dashboard →').click();
await win.waitForSelector('.hero');

// Load demo data through the in-app confirm, then immediately type in Add income (the reported bug path)
await nav('Settings');
await win.getByRole('button', { name: 'Load demo data' }).click();
await win.getByRole('button', { name: 'Replace with demo data' }).click();
await win.waitForTimeout(400);
await win.getByRole('button', { name: '+ Add income' }).click();
await checkInputs('Settings › Add income (after confirm)', '.modal');
await win.getByText('Hourly rate').click(); await checkInputs('Settings › Add income hourly', '.modal');
await win.getByText('Tax code, pension & deductions').click().catch(() => {});
await win.getByText('+ Add deduction').click().catch(() => {});
await checkInputs('Settings › Add income tax', '.modal');
await closeModal();
await win.getByLabel('Edit Acme Ltd salary').click(); await checkInputs('Settings › Edit income', '.modal'); await closeModal();
await checkInputs('Settings page');
await win.locator('.fx-table button', { hasText: 'set manually' }).first().click();
await checkInputs('Settings › Set rate dialog', '.modal'); await closeModal();

// Every page
for (const p of ['Dashboard', 'Pay Planner', 'Insights', 'Receipts', 'Transactions', 'Bills & Income', 'Debts & Loans', 'Budgets & Caps', 'AI Plan', 'Bank Sync', 'Help & feedback']) {
  await nav(p); await win.waitForTimeout(250);
  await checkInputs(`${p} page`);
}
// Every popup
await win.getByRole('button', { name: '+ Add transaction' }).click(); await checkInputs('Add transaction', '.modal');
await win.getByText('I paid for others').click().catch(() => {}); await checkInputs('Add transaction (split)', '.modal'); await closeModal();
await nav('Transactions');
await win.locator('.txns .linkish').first().click(); await checkInputs('Edit transaction', '.modal'); await closeModal();
await win.locator('label.switch.sm').nth(1).click(); await checkInputs('Split popup', '.modal');
await win.getByText('Exact amount back').click(); await checkInputs('Split popup (exact)', '.modal'); await closeModal();
await win.getByRole('button', { name: /🤝 Link/ }).first().click(); await checkInputs('Link repayment popup', '.modal'); await closeModal();
await win.getByRole('button', { name: /Itemise/ }).first().click(); await checkInputs('Receipt popup', '.modal');
await win.getByRole('button', { name: '+ Add row' }).click(); await checkInputs('Receipt popup rows', '.modal'); await closeModal();
await nav('Bills & Income'); await win.getByRole('button', { name: '+ Add recurring' }).click(); await checkInputs('Add recurring', '.modal');
await win.locator('.modal select:has(option[value=weekly])').selectOption('weekly'); await checkInputs('Add recurring weekly', '.modal'); await closeModal();
await win.getByLabel('Edit').first().click(); await checkInputs('Edit recurring', '.modal'); await closeModal();
await win.getByRole('button', { name: '+ Add recurring' }).click();
await win.getByText('Amount changes each time').click(); await checkInputs('Add recurring (amount varies)', '.modal'); await closeModal();
await nav('Debts & Loans'); await win.getByRole('button', { name: '+ Add debt' }).click(); await checkInputs('Add debt', '.modal');
await win.locator('.modal select:has(option[value=full])').selectOption('full'); await checkInputs('Add debt (pay in full)', '.modal');
await win.locator('.modal select:has(option[value=full])').selectOption('fixed'); await checkInputs('Add debt (fixed payment)', '.modal'); await closeModal();
await win.getByLabel('Edit').first().click(); await checkInputs('Edit debt', '.modal'); await closeModal();
await nav('Budgets & Caps'); await win.getByRole('button', { name: '+ New cap' }).click(); await checkInputs('New cap', '.modal'); await closeModal();
await win.getByLabel('Edit cap').first().click(); await checkInputs('Edit cap', '.modal'); await closeModal();
await nav('Pay Planner'); await win.getByRole('button', { name: '+ New goal' }).click(); await checkInputs('New goal', '.modal'); await closeModal();
await win.getByLabel('Edit goal').first().click(); await checkInputs('Edit goal', '.modal'); await closeModal();
// Bank Sync: Monzo setup form, statement guides and the EU section.
await nav('Bank Sync');
await win.getByRole('button', { name: /Set up Monzo/ }).click(); await checkInputs('Bank Sync › Monzo setup');
await win.getByText("Where's the download button for my bank?").click();
await win.getByText(/EU \/ EEA banks/).click(); await checkInputs('Bank Sync › EU banks');
// Edit a single payday from the calendar and check the change flows through.
await nav('Dashboard');
await win.getByLabel('Next month').click();
await win.locator('.cal-day.payday', { hasText: 'PAY' }).last().click();
const leftBefore = await win.locator('.hero-num').innerText();
await win.getByRole('button', { name: '✎ Edit' }).first().click();
await checkInputs('Edit payday popup', '.modal');
await closeModal(); // discard the test typing (it also changed the date), then edit for real
await win.getByRole('button', { name: '✎ Edit' }).first().click();
await win.locator('.modal input[type=number]').first().fill('1234.5');
await win.locator('.modal input').filter({ hasNot: win.locator('[type]') }).last().fill('Test: 2 days unpaid').catch(() => {});
await win.locator('.modal').getByRole('button', { name: 'Save', exact: true }).click();
await win.waitForTimeout(300);
const edited = await win.locator('.list-row', { hasText: '✎ edited' }).count();
const chipEdited = await win.locator('.chip.edited').count();
const leftAfter = await win.locator('.hero-num').innerText();
if (!edited || !chipEdited || leftAfter === leftBefore) results.fail.push(`Payday edit did not flow through (panel ${edited}, chip ${chipEdited}, left ${leftBefore} -> ${leftAfter})`);
else results.ok++;
await win.getByRole('button', { name: '✎ Edit' }).first().click();
await win.getByRole('button', { name: 'Reset to normal' }).click();
await win.waitForTimeout(300);
if ((await win.locator('.hero-num').innerText()) !== leftBefore) results.fail.push('Reset to normal did not restore the original amount');
await nav('Pay Planner');
await win.locator('.pay-edit').first().click();
await checkInputs('Planner › Edit payday', '.modal'); await closeModal();
// A bill whose amount varies: entering the real amount from "Needs your attention" clears the question.
await nav('Dashboard');
const billQ = win.locator('.review-item.bill-amount');
if (await billQ.count()) {
  await billQ.first().locator('input[type=number]').fill('123.45');
  await billQ.first().getByRole('button', { name: 'Save amount' }).click();
  await win.waitForTimeout(300);
  const left = await win.locator('.review-item.bill-amount').count();
  if (left) results.fail.push('Entering a variable bill amount did not clear the attention item');
  else results.ok++;
}
// Credit card from its own statement: the new-account question, card setup, EMI conversion, Debts.
await win.evaluate(() => window.pulse.dispatch({ type: 'txn/import', payload: { source: 'csv', fileName: 'barclaycard.csv', rows: [
  { date: '2026-09-02', amount: 54.2, description: 'TESCO STORES', account: 'Barclaycard' },
  { date: '2026-09-10', amount: 899, description: 'CURRYS PC WORLD', account: 'Barclaycard' },
  { date: '2026-09-15', amount: 18.5, description: 'PRET A MANGER', account: 'Barclaycard' },
] } }));
await win.getByRole('dialog', { name: 'New account found' }).waitFor({ timeout: 5000 });
await win.getByRole('button', { name: "Yes, it's a credit card" }).click();
await checkInputs('Card setup', '.modal');
await win.locator('.modal input[placeholder="e.g. 28"]').fill('28');
await win.locator('.modal input[placeholder="e.g. 20"]').fill('20');
await win.locator('.modal input').first().fill('Barclaycard');
if (!(await win.locator('.modal input[type=checkbox]').last().isChecked())) results.fail.push('Card setup did not spot positive purchases in the file');
await win.locator('.modal').getByRole('button', { name: 'Save card' }).click();
await win.waitForTimeout(300);
await nav('Transactions');
await win.locator('.filters select[aria-label=Account]').selectOption('Barclaycard');
await win.getByRole('button', { name: 'Convert to EMI' }).first().waitFor({ timeout: 3000 });
const currysRow = win.locator('tr', { hasText: 'CURRYS PC WORLD' });
await currysRow.getByRole('button', { name: 'Convert to EMI' }).click();
await checkInputs('Convert to EMI', '.modal');
await win.locator('.modal').getByRole('button', { name: 'Cancel' }).click();
await currysRow.getByRole('button', { name: 'Convert to EMI' }).click();
await win.locator('.modal').getByRole('button', { name: 'Convert to EMI' }).click();
await win.waitForTimeout(300);
await nav('Debts & Loans');
const emiCard = await win.locator('.card.debt .card-plans .list-row', { hasText: 'CURRYS' }).count();
const cardCard = await win.locator('.card.debt', { hasText: 'Next bill' }).count();
if (!emiCard || !cardCard) results.fail.push(`Debts page missing tracked card (${cardCard}) or EMI plan (${emiCard})`); else results.ok++;
const cardBox = win.locator('.card.debt', { hasText: 'Next bill' }).first();
await cardBox.getByRole('button', { name: /What's in this bill/ }).click();
if (!(await cardBox.locator('.bill-lines .list-row').count())) results.fail.push('Card bill breakdown is empty'); else results.ok++;
await cardBox.getByRole('button', { name: 'Bill amount is different?' }).click();
await checkInputs('Card bill correction', '.card.debt');
await cardBox.locator('input[aria-label="Real bill amount"]').fill('176.35');
await cardBox.getByRole('button', { name: 'Save', exact: true }).click();
await win.waitForTimeout(300);
if (!(await cardBox.innerText()).includes('176.35')) results.fail.push('Entered card bill amount not shown'); else results.ok++;
await cardBox.getByRole('button', { name: /Use Pulse's figure/ }).click();
await win.getByLabel('Edit Barclaycard').click(); await checkInputs('Edit card', '.modal'); await closeModal();
// Monzo Flex with "Choose for every purchase": the dashboard asks how each purchase is paid.
await win.evaluate(() => window.pulse.dispatch({ type: 'txn/import', payload: { source: 'monzo', rows: [
  { date: '2026-09-29', amount: -240, description: 'NIKE', account: 'Monzo Flex' },
  { date: '2026-09-30', amount: -12.5, description: 'DELIVEROO', account: 'Monzo Flex' },
] } }));
await win.getByRole('dialog', { name: 'New account found' }).waitFor({ timeout: 5000 });
await win.getByRole('button', { name: "Yes, it's a credit card" }).click();
await win.locator('.modal input[placeholder="e.g. 28"]').fill('27');
await win.locator('.modal input[placeholder="e.g. 20"]').fill('10');
await win.locator('.modal .plan-opt', { hasText: 'I choose for every purchase' }).click();
await checkInputs('Flex card setup (choose mode)', '.modal');
await win.locator('.modal input[placeholder="e.g. 28"]').fill('27'); // checkInputs typed over the dates
await win.locator('.modal input[placeholder="e.g. 20"]').fill('10');
await win.locator('.modal').getByRole('button', { name: 'Save card' }).click();
await nav('Dashboard');
const nikeQ = win.locator('.review-item.card-plan', { hasText: 'NIKE' });
await nikeQ.waitFor({ timeout: 3000 });
await nikeQ.getByRole('button', { name: /^3 mo/ }).click();
await win.waitForTimeout(300);
if (await win.locator('.review-item.card-plan', { hasText: 'NIKE' }).count()) results.fail.push('Choosing a Flex plan did not clear the question'); else results.ok++;
await nav('Debts & Loans');
if (!(await win.locator('.card-plans .list-row', { hasText: 'NIKE' }).count())) results.fail.push('Flex plan missing on Debts'); else results.ok++;
await nav('Settings');
if (!(await win.locator('#accounts select[aria-label="Type of Barclaycard"]').count())) results.fail.push('Settings › accounts list missing the card'); else results.ok++;

await nav('Dashboard'); await checkInputs('Dashboard after all');

console.log(`inputs typed OK: ${results.ok}`);
console.log('failures:', results.fail.length ? results.fail : 'none');
console.log('page errors:', errors);
await app.evaluate(({ app }) => app.exit(0));
if (results.fail.length || errors.length || results.ok < 100) process.exit(1);
