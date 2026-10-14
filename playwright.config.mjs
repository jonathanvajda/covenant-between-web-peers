import { defineConfig } from '@playwright/test';
export default defineConfig({
    testDir: './tests/browser',
    timeout: 60000,
    workers: 1,
    use: { baseURL: 'http://127.0.0.1:4173/covenant-between-web-peers/', browserName: 'chromium' },
    webServer: { command: 'node tests/static-server.mjs', url: 'http://127.0.0.1:4173/covenant-between-web-peers/', reuseExistingServer: !process.env.CI }
});
