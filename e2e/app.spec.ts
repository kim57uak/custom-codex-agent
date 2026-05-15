import { _electron as electron, test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  app = await electron.launch({ args: ['.'] });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app.close();
});

// ======== Layout ========

test('should launch and show app shell grid', async () => {
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.activity-bar')).toBeVisible();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.main-area')).toBeVisible();
  await expect(page.locator('.panel')).toBeVisible();
  await expect(page.locator('.status-bar')).toBeVisible();
});

test('should have at least 5 activity bar icons', async () => {
  const buttons = page.locator('.activity-bar__item');
  expect(await buttons.count()).toBeGreaterThanOrEqual(5);
});

test('should render sidebar with tabs and content', async () => {
  await expect(page.locator('.sidebar-tabs')).toBeVisible();
  await expect(page.locator('.sidebar-content')).toBeVisible();
});

test('should switch panel tabs', async () => {
  const tabs = page.locator('.panel__tab');
  expect(await tabs.count()).toBe(4);
  await tabs.nth(1).click();
  await expect(page.locator('.panel__content--output')).toBeVisible();
  await tabs.nth(2).click();
  await expect(page.locator('.panel__content--events')).toBeVisible();
});

test('should show status bar with version info', async () => {
  await expect(page.locator('.status-bar__item').first()).toBeVisible();
  await expect(page.locator('.status-bar')).toContainText('Codex');
});

// ======== View Navigation ========

test('should switch views via activity bar clicks', async () => {
  const views = ['org', 'dashboard', 'console', 'workflow', 'inspector'];
  const buttons = page.locator('.activity-bar__item');
  for (let i = 0; i < views.length; i++) {
    await buttons.nth(i).click();
    await page.waitForTimeout(200);
  }
});

test('should show Dashboard metrics after switching to dashboard view', async () => {
  await page.locator('.activity-bar__item').nth(1).click();
  await page.waitForTimeout(300);
  await expect(page.locator('.main-toolbar')).toBeVisible();
});

test('should show Console after clicking console icon', async () => {
  await page.locator('.activity-bar__item').nth(2).click();
  await page.waitForTimeout(300);
  await expect(page.locator('.console-view')).toBeVisible();
});

test('should show Workflow view', async () => {
  await page.locator('.activity-bar__item').nth(3).click();
  await page.waitForTimeout(300);
  await expect(page.locator('.workflow-view')).toBeVisible();
});

test('should show Inspector view', async () => {
  await page.locator('.activity-bar__item').nth(4).click();
  await page.waitForTimeout(300);
  await expect(page.locator('.inspector-view')).toBeVisible();
});

// ======== IPC ========

test('should expose electronAPI on window', async () => {
  const hasInvoke = await page.evaluate(() => {
    return typeof (window as any).electronAPI?.invoke === 'function';
  });
  expect(hasInvoke).toBe(true);

  const hasSend = await page.evaluate(() => {
    return typeof (window as any).electronAPI?.send === 'function';
  });
  expect(hasSend).toBe(true);

  const hasOn = await page.evaluate(() => {
    return typeof (window as any).electronAPI?.on === 'function';
  });
  expect(hasOn).toBe(true);
});

test('should invoke IPC handlers with real data', async () => {
  const results = await page.evaluate(async () => {
    const api = (window as any).electronAPI;
    const out: Record<string, unknown> = {};

    try { out.agentsList = await api.invoke('agents:list'); } catch (e: any) { out.agentsList = `ERR:${e.message}`; }
    try { out.dashboardStats = await api.invoke('dashboard:stats'); } catch (e: any) { out.dashboardStats = `ERR:${e.message}`; }
    try { out.chatSend = await api.invoke('chat:send', { message: 'Say hello in one Korean word' }); } catch (e: any) { out.chatSend = `ERR:${e.message}`; }
    try { out.cliValidate = await api.invoke('cli:validate', '/opt/homebrew/bin/gemini'); } catch (e: any) { out.cliValidate = `ERR:${e.message}`; }
    try { out.workflowList = await api.invoke('workflow:list'); } catch (e: any) { out.workflowList = `ERR:${e.message}`; }
    try { out.dirRead = await api.invoke('dir:read', { path: '' }); } catch (e: any) { out.dirRead = `ERR:${e.message}`; }
    try { out.recentActivity = await api.invoke('dashboard:recent-activity'); } catch (e: any) { out.recentActivity = `ERR:${e.message}`; }

    return out;
  });

  // 1. agents:list — real array
  expect(Array.isArray(results.agentsList)).toBe(true);

  // 2. dashboard:stats — real numbers
  const stats = results.dashboardStats as Record<string, unknown>;
  expect(typeof stats.totalRuns).toBe('number');
  expect(typeof stats.totalAgents).toBe('number');
  expect(typeof stats.successRate).toBe('number');

  // 3. chat:send — real Gemini response (not placeholder)
  const chat = results.chatSend as Record<string, unknown>;
  expect(chat).toHaveProperty('response');
  expect(typeof chat.response).toBe('string');
  expect((chat.response as string).length).toBeGreaterThan(0);
  // Placeholder detect: gemini가 한글 응답하면 placeholder 아님
  expect((chat.response as string)).not.toContain('Phase 5');
  expect((chat.response as string)).not.toContain('죄송합니다');

  // 4. cli:validate — valid gemini path
  const cli = results.cliValidate as Record<string, unknown>;
  if ((cli as any).valid === false) {
    // gemini not found at path — still must return valid object
    expect(cli).toHaveProperty('valid');
    expect(cli).toHaveProperty('error');
  } else {
    expect(cli).toHaveProperty('version');
  }

  // 5. workflow:list — real array
  expect(Array.isArray(results.workflowList)).toBe(true);

  // 6. dir:read — real directory entries
  const dir = results.dirRead as Record<string, unknown>;
  if (dir && (dir as any).entries) {
    expect(Array.isArray((dir as any).entries)).toBe(true);
  }

  // 7. dashboard:recent-activity — real activity list
  const activity = results.recentActivity as Record<string, unknown>;
  expect(activity).toHaveProperty('activities');
  expect(Array.isArray((activity as any).activities)).toBe(true);
});

test('should call agents:list IPC without throwing', async () => {
  const result = await page.evaluate(async () => {
    try {
      return await (window as any).electronAPI.invoke('agents:list');
    } catch (e: any) {
      return `ERROR: ${e.message}`;
    }
  });
  expect(Array.isArray(result)).toBe(true);
});

test('should call cli:validate IPC without throwing', async () => {
  const result = await page.evaluate(async () => {
    try {
      return await (window as any).electronAPI.invoke('cli:validate', '/usr/local/bin/codex');
    } catch (e: any) {
      return `ERROR: ${e.message}`;
    }
  });
  expect(typeof result).toBe('object');
});

test('should reject invalid IPC channel gracefully', async () => {
  const result = await page.evaluate(async () => {
    try {
      return await (window as any).electronAPI.invoke('nonexistent:channel');
    } catch (e: any) {
      return `ERROR: ${e.message}`;
    }
  });
  expect(result).toContain('ERROR');
});
