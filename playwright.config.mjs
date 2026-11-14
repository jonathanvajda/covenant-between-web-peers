import { defineConfig } from '@playwright/test';
export default defineConfig({
    testDir: './tests/browser',
    timeout: 60000,
    workers: 1,
    forbidOnly: Boolean(process.env.CI),
    retries: 0,
    reporter: process.env.CI
        ? [['github'], ['html', { open: 'never' }]]
        : [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: 'http://127.0.0.1:4173/covenant-between-web-peers/', browserName: 'chromium',
        trace: 'retain-on-failure', screenshot: 'only-on-failure'
    },
    webServer: { command: 'node tests/static-server.mjs', url: 'http://127.0.0.1:4173/covenant-between-web-peers/', reuseExistingServer: !process.env.CI }
});
