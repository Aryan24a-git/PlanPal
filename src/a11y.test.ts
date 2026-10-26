/**
 * A11Y-001 & A11Y-002: Automated Accessibility Test Suite.
 * Validates WCAG 2.1 AA compliance constraints on the rendered HTML and styles:
 * - Landmark roles and semantic document structure
 * - Form input labels and autocomplete attributes
 * - Live regions and dynamic announcement containers
 * - Touch target sizing and accessible names
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
const cssPath = path.join(__dirname, '..', 'public', 'css', 'styles.css');

describe('A11Y-001 & A11Y-002: Accessibility Standards Verification', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');

  it('declares document language', () => {
    expect(html).toMatch(/<html[^>]+lang=["']en["']/i);
  });

  it('includes viewport meta for responsive scaling without user-scalable=no', () => {
    expect(html).toMatch(/<meta[^>]+name=["']viewport["'][^>]+content=["'][^"']*width=device-width/i);
    expect(html).not.toMatch(/user-scalable=["']?no["']?/i);
  });

  it('contains primary landmark roles (banner, main, navigation)', () => {
    expect(html).toMatch(/role=["']banner["']/i);
    expect(html).toMatch(/role=["']main["']/i);
    expect(html).toMatch(/role=["']navigation["']/i);
  });

  it('provides an aria-live region for dynamic AI announcements', () => {
    expect(html).toMatch(/id=["']live-announcer["'][^>]+aria-live=["']polite["']/i);
    expect(html).toMatch(/id=["']live-announcer["'][^>]+aria-atomic=["']true["']/i);
  });

  it('provides a live region for toast notifications', () => {
    expect(html).toMatch(/id=["']toast-container["'][^>]+role=["']status["']/i);
    expect(html).toMatch(/id=["']toast-container["'][^>]+aria-live=["']polite["']/i);
  });

  it('ensures all text inputs have associated labels or ids matching label for attributes', () => {
    const inputMatches = [...html.matchAll(/<input[^>]+id=["']([^"']+)["'][^>]*>/gi)];
    expect(inputMatches.length).toBeGreaterThan(0);

    for (const match of inputMatches) {
      const inputId = match[1];
      // Skip hidden or submit inputs
      if (match[0].includes('type="hidden"') || match[0].includes('type="submit"')) continue;
      const labelRegex = new RegExp(`<label[^>]+for=["']${inputId}["']`, 'i');
      const hasLabel = labelRegex.test(html);
      expect(hasLabel, `Input #${inputId} must have an associated <label for="${inputId}">`).toBe(true);
    }
  });

  it('ensures authentication inputs have proper autocomplete attributes', () => {
    expect(html).toMatch(/id=["']login-email["'][^>]+autocomplete=["']email["']/i);
    expect(html).toMatch(/id=["']login-password["'][^>]+autocomplete=["']current-password["']/i);
  });

  it('enforces 44px minimum touch targets in stylesheet (WCAG Target Size)', () => {
    expect(css).toMatch(/min-height:\s*44px/);
  });

  it('defines visible focus styling in CSS for keyboard navigation', () => {
    expect(css).toMatch(/:focus-visible/);
  });

  it('includes dark mode and accessible contrast palette variables', () => {
    expect(css).toMatch(/--text-main/);
    expect(css).toMatch(/--bg-dark/);
    expect(css).toMatch(/--primary/);
  });

  it('verifies all modal backdrops use role="dialog" and aria-modal="true"', () => {
    const dialogMatches = [...html.matchAll(/<div[^>]+role=["']dialog["'][^>]*>/gi)];
    expect(dialogMatches.length).toBeGreaterThanOrEqual(6);
    for (const match of dialogMatches) {
      expect(match[0]).toMatch(/aria-modal=["']true["']/i);
      expect(match[0]).toMatch(/aria-labelledby=["'][^"']+["']/i);
    }
  });

  it('verifies workspace tab navigation uses role="tablist" and role="tab"', () => {
    expect(html).toMatch(/role=["']tablist["']/i);
    const tabMatches = [...html.matchAll(/role=["']tab["']/gi)];
    expect(tabMatches.length).toBeGreaterThanOrEqual(4);
  });

  it('verifies client JS implements focus management, Escape dismiss, and tab traps', () => {
    const jsPath = path.join(__dirname, '..', 'public', 'js', 'app.js');
    const js = fs.readFileSync(jsPath, 'utf8');
    expect(js).toMatch(/openModalDialog/);
    expect(js).toMatch(/closeModalDialog/);
    expect(js).toMatch(/e\.key === ['"]Escape['"]/);
    expect(js).toMatch(/e\.key !==? ['"]Tab['"]/);
    expect(js).toMatch(/focusable\[0\]\.focus\(\)/);
  });
});
