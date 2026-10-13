import { expect, test, type Page } from '@playwright/test';

/** Start a new room and give it a rectangle from Quick room. */
async function newRectRoom(page: Page, width?: string, length?: string): Promise<string> {
  await page.getByRole('button', { name: 'New room', exact: true }).first().click();
  const name = await page.getByLabel('Project name').inputValue();

  await page.getByRole('button', { name: 'Quick room…' }).click();
  if (width) await page.getByLabel('Room width').fill(width);
  if (length) await page.getByLabel('Room length').fill(length);
  // Blur commits the last field before Create reads it.
  await page.getByLabel('Room length').press('Tab');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.save-dot')).toHaveText('Saved');
  return name;
}

/** The project-list row for exactly this name ("Room 1" must not match "Room 10"). */
function projectRow(page: Page, name: string) {
  const exact = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  return page
    .locator('.project-row')
    .filter({ has: page.locator('.project-open > span:first-child', { hasText: exact }) });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
});

test('a room built from inside measurements reads back those measurements', async ({
  page,
}) => {
  await newRectRoom(page, `12'-6"`, `10'`);

  // 12.5 ft x 10 ft of floor, not the centreline outline around it.
  await expect(page.locator('.stat-grid')).toContainText('125.0 sq ft');
});

test('switching rooms straight after an edit keeps the edit', async ({ page }) => {
  const first = await newRectRoom(page);

  await page.getByRole('button', { name: /Seating/ }).click();
  await page.locator('.item-card', { hasText: 'Three-seat sofa' }).dblclick();

  // Leave inside the autosave debounce, before it would have fired.
  await page.getByRole('button', { name: 'New room', exact: true }).first().click();
  await expect(page.locator('.save-dot')).toHaveText('Saved');

  await expect(projectRow(page, first)).toContainText('1 items');

  // And it's really on disk, not just in this tab.
  await page.reload();
  await expect(projectRow(page, first)).toContainText('1 items');
});

test('a reload reopens the last room with its furniture', async ({ page }) => {
  const name = await newRectRoom(page);
  await page.getByRole('button', { name: /Seating/ }).click();
  await page.locator('.item-card', { hasText: 'Three-seat sofa' }).dblclick();
  await expect(page.locator('.save-dot')).toHaveText('Saved');

  await page.reload();
  await expect(page.getByLabel('Project name')).toHaveValue(name);
  await expect(page.locator('.statusbar')).toContainText('No conflicts');
  await expect(projectRow(page, name)).toContainText('1 items');
});
