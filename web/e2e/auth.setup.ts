import { test as setup, expect } from '@playwright/test';
import path from 'path';

const authFile = path.join(import.meta.dirname, '.auth/user.json');

// Pre-generated JWT for the playwright@test.local test account (playwright-test-user).
// Expires 2027. To regenerate:
//   node -e "const jwt=require('./server/node_modules/jsonwebtoken'); const s=require('./server/data/secrets.json'); console.log(jwt.sign({userId:'playwright-test-user'},s.jwtSecret,{expiresIn:'365d'}))"
const PLAYWRIGHT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJwbGF5d3JpZ2h0LXRlc3QtdXNlciIsImlhdCI6MTc4MjY3NTY0MywiZXhwIjoxODE0MjExNjQzfQ.oK7qZfwIPPWU1oE_nFqikaTHnMB3e2K8YNERgZkvaCA';

setup('authenticate', async ({ page }) => {
  // Use addInitScript so the token is in localStorage before React mounts —
  // avoids the rate-limited /auth/login endpoint entirely.
  await page.addInitScript((token) => {
    localStorage.setItem('unnamedproject_token', token);
  }, PLAYWRIGHT_TOKEN);

  await page.goto('/home');
  await expect(page).not.toHaveURL(/\/login/, { timeout: 8_000 });

  await page.context().storageState({ path: authFile });
});
