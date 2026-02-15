#!/usr/bin/env node
/**
 * PayPal subscription use-case validation (no network).
 * Run: node scripts/paypal-subscription-use-cases.js
 * Requires: from project root, so DGMARQ-Backend is cwd or set NODE_PATH.
 */
import { validatePlanIdFormat } from '../src/services/payment.service.js';

const cases = [
  { name: 'Valid active plan ID (P-xxx)', planId: 'P-2UF02951V2758821MNGFSXHA', expectValid: true },
  { name: 'Plan exists but inactive', planId: 'P-XXXXXXXXXXXX', expectValid: true }, // format only
  { name: 'Invalid plan format (wrong prefix)', planId: 'X-123', expectValid: false },
  { name: 'Product ID used as plan (PROD-)', planId: 'PROD-ABC123', expectValid: false },
  { name: 'Empty plan ID', planId: '', expectValid: false },
  { name: 'Missing plan ID', planId: null, expectValid: false },
];

console.log('PayPal subscription – plan ID format use cases\n');
let passed = 0;
for (const c of cases) {
  const result = validatePlanIdFormat(c.planId);
  const ok = c.expectValid ? result.valid : !result.valid;
  if (ok) passed++;
  console.log(`${ok ? '✓' : '✗'} ${c.name}`);
  if (!result.valid && result.error) console.log(`  → ${result.error}`);
}
console.log(`\n${passed}/${cases.length} format checks passed.`);
console.log('\nOther cases (require PayPal API / env):');
console.log('  - Sandbox plan in live: use PAYPAL_ENV=production + live plan P-xxx');
console.log('  - Live plan in sandbox: use PAYPAL_ENV=sandbox + sandbox plan P-xxx');
console.log('  - Missing/expired token: handled by generateAccessToken + paypalErrorHandler');
console.log('  - Wrong credentials: validatePayPalEnvironment + token error with debug_id');
