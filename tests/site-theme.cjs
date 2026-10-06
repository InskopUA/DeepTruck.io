const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../verify-site');
const adminRoot = path.resolve(__dirname, '../admin-site');
const origin = 'https://deeptruck.test';

// Inspect rendered text against its composited background, including translucent
// cards and gradient stops. SVG artwork and intentionally clipped decorative text
// are excluded; real headings, links, badges and fine-print are included.
async function contrast(page) {
  return page.evaluate(() => {
    const parse = value => {
      const match = value.match(/^rgba?\(([^)]+)\)/);
      return match ? match[1].split(',').map(Number).concat(match[1].split(',').length === 3 ? [1] : []) : [0, 0, 0, 0];
    };
    const blend = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3])).concat(1);
    const luminance = rgb => rgb.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
    const failures = [];
    for (const el of document.body.querySelectorAll('*')) {
      const input = el.matches('input');
      const text = input ? el.value ? 'Entered input value' : el.placeholder : [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent.trim()).filter(Boolean).join(' ');
      if (!text || el.closest('svg, [inert], .faq-a[aria-hidden="true"], script, style') || !el.getClientRects().length) continue;
      const style = getComputedStyle(el, input && !el.value ? '::placeholder' : null);
      if (style.visibility === 'hidden' || parse(style.color)[3] === 0) continue;
      const chain = []; let opacity = 1;
      for (let node = el; node; node = node.parentElement) { chain.push(getComputedStyle(node)); opacity *= Number(getComputedStyle(node).opacity); }
      if (opacity < .05) continue;
      let backgrounds = [{color: [255, 255, 255, 1], layers: []}];
      for (const css of chain.reverse()) {
        backgrounds = backgrounds.map(bg => ({color: blend(parse(css.backgroundColor), bg.color), layers: [...bg.layers, {backdrop: bg.color, opacity: Number(css.opacity)}]}));
        if (css.backgroundImage.includes('gradient') && !css.backgroundClip.includes('text')) {
          const stops = css.backgroundImage.match(/rgba?\([^)]+\)/g) || [];
          if (stops.length) backgrounds = backgrounds.flatMap(bg => stops.map(stop => ({...bg, color: blend(parse(stop), bg.color)})));
        }
      }
      const color = parse(style.color);
      const actual = Math.min(...backgrounds.map(sample => {
        let fg = blend(color, sample.color), bg = sample.color;
        for (const layer of [...sample.layers].reverse()) {
          fg = blend(fg.slice(0, 3).concat(layer.opacity), layer.backdrop);
          bg = blend(bg.slice(0, 3).concat(layer.opacity), layer.backdrop);
        }
        return ratio(fg, bg);
      }));
      const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
      const required = large ? 3 : 4.5;
      if (actual + .02 < required) failures.push({ selector: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim().replace(/\s+/g, '.') : ''), text: text.slice(0, 70), ratio: +actual.toFixed(2), required, color: style.color });
    }
    return failures;
  });
}

const typography = page => page.evaluate(() => Object.fromEntries(['.hero h1', '.hero .lead', '.section-title', '.feature-item strong', '.price', '.faq-q', '.footer-left .brand'].map(selector => {
  const css = getComputedStyle(document.querySelector(selector));
  return [selector, [css.fontFamily, css.fontSize, css.fontWeight, css.lineHeight, css.letterSpacing]];
})));

(async () => {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({headless: true, executablePath});
  const reports = [];
  try {
    const context = await browser.newContext({reducedMotion: 'reduce'});
    // Exercise the real auth forms with a local SDK stub; no accounts or emails
    // are created, and tests cannot send credentials to the live service.
    await context.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', route => route.fulfill({contentType: 'application/javascript', body: `
      window.supabase = {createClient: () => ({auth: {
        getSession: async () => ({data: {session: null}}),
        onAuthStateChange: () => {},
        signInWithPassword: () => new Promise(resolve => { window.finishAuthRequest = error => resolve({data: {session: null}, error: error ? {message: 'Invalid email or password.'} : null}); }),
        signUp: () => new Promise(resolve => { window.finishAuthRequest = error => resolve({data: {session: null}, error: error ? {message: 'Please try again.'} : null}); })
      }})};
    `}));
    await context.route(origin + '/**', route => {
      let pathname = new URL(route.request().url()).pathname;
      if (pathname === '/') pathname = '/index.html';
      if (['/privacy', '/terms'].includes(pathname)) pathname += '.html';
      if (['/login', '/signup'].includes(pathname)) pathname = '/admin' + pathname + '.html';
      const base = pathname.startsWith('/admin/') ? adminRoot : root;
      const file = path.resolve(base, '.' + (base === adminRoot ? pathname.slice(6) : pathname));
      if (!file.startsWith(base + path.sep) || !fs.existsSync(file)) return route.fulfill({status: 404});
      const types = {'.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.jpg': 'image/jpeg'};
      return route.fulfill({contentType: types[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file)});
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({width, height: 900});
      await page.goto(origin);
      // Reveal every section and expose all responsive panels for contrast auditing.
      await page.evaluate(() => document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible')));
      if (await page.locator('.faq-q').first().getAttribute('aria-expanded') !== 'true') await page.locator('.faq-q').first().click();
      await page.waitForTimeout(350);
      let originalType;
      for (const theme of ['dark', 'light']) {
        const toggle = page.getByRole('switch', {name: 'Light theme'});
        if (await toggle.getAttribute('aria-checked') !== String(theme === 'light')) await toggle.click();
        await page.waitForTimeout(350);
        await page.evaluate(() => document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible')));
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width} ${theme}: horizontal overflow`);
        const violations = await contrast(page); reports.push({page: '/', width, theme, violations});
        if (theme === 'dark') originalType = await typography(page);
        else assert.deepEqual(await typography(page), originalType, 'theme preserves typography');
        if ([1440, 390].includes(width)) {
          await page.screenshot({path: `/private/tmp/deeptruck-site-${theme}-${width}.png`, fullPage: true});
          await page.locator('.site-footer').screenshot({path: `/private/tmp/deeptruck-footer-${theme}-${width}.png`});
          await page.evaluate(() => window.scrollTo({top: 0, behavior: 'instant'}));
          await page.screenshot({path: `/private/tmp/deeptruck-hero-${theme}-${width}.png`});
          await page.locator('.extension-card').screenshot({path: `/private/tmp/deeptruck-extension-${theme}-${width}.png`});
        }
        assert.deepEqual(violations, [], `${width}px ${theme} theme contrast`);
        if (theme === 'light') {
          assert.equal(await page.locator('.feature-visual .demo-surface').first().evaluate(el => getComputedStyle(el).boxShadow), 'none', 'scrolling slides do not cast shadows into their gaps');
          if (width === 1440) {
            await page.locator('[data-feature-index="4"]').click(); await page.waitForTimeout(350);
            await page.screenshot({path: '/private/tmp/deeptruck-feature-gap-light.png'});
          }
        }
        // Hover states must stay readable too, including the filled pricing CTA.
        for (const selector of ['.hero-actions .btn-primary', '.price-card.featured .btn-primary', '.faq-q', '.theme-toggle']) {
          await page.locator(selector).first().hover(); await page.waitForTimeout(350);
          assert.deepEqual(await contrast(page), [], `${width}px ${theme} ${selector} hover contrast`);
        }
        const question = page.locator('.faq-q').first(), card = page.locator('.faq-item').first();
        await question.hover(); await page.waitForTimeout(350);
        assert.equal(await question.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'header cannot cover the open card highlight or left accent');
        const cardColor = await card.evaluate(el => getComputedStyle(el).backgroundColor);
        await page.locator('.faq-answer-inner p').first().hover(); await page.waitForTimeout(350);
        assert.equal(await card.evaluate(el => getComputedStyle(el).backgroundColor), cardColor, 'hovering header or answer highlights the same full card');
        if (theme === 'light' && [1440, 390].includes(width)) await card.screenshot({path: `/private/tmp/deeptruck-faq-hover-${width}.png`});
        await question.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
        assert.equal(await question.evaluate(el => getComputedStyle(el).outlineStyle), 'none', 'no focus outline across the header/answer seam');
        assert.equal(await card.evaluate(el => getComputedStyle(el).outlineStyle), 'solid', 'keyboard focus outlines the full card');
        await question.click(); assert.equal(await question.getAttribute('aria-expanded'), 'false');
        await question.click(); assert.equal(await question.getAttribute('aria-expanded'), 'true');
        await page.waitForTimeout(350);
      }
      await page.reload(); assert.equal(await page.locator('html').getAttribute('data-theme'), 'light', 'theme survives reload');
      if (width < 761) {
        await page.locator('#hamburger').click(); assert.equal(await page.locator('#hamburger').getAttribute('aria-expanded'), 'true');
        await page.waitForTimeout(350); assert.deepEqual(await contrast(page), [], 'open mobile menu contrast');
        await page.locator('#navLinks a').first().click(); assert.equal(await page.locator('#hamburger').getAttribute('aria-expanded'), 'false');
      }
      for (const route of ['/privacy', '/terms']) {
        await page.goto(origin + route);
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${route} ${width}: overflow`);
        const violations = await contrast(page); reports.push({page: route, width, theme: 'light', violations});
        assert.deepEqual(violations, [], `${route} ${width}px contrast`);
        await page.getByRole('switch', {name: 'Light theme'}).click();
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
        await page.getByRole('switch', {name: 'Light theme'}).focus(); await page.keyboard.press('Space');
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'light', 'keyboard theme switch');
      }
      for (const route of ['/login', '/signup']) {
        await page.goto(origin + route);
        await page.waitForFunction(() => !document.getElementById('auth-submit').disabled);
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
        assert.equal(await page.locator('.auth-page').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(237, 242, 247)');
        assert.equal(await page.locator('[data-theme-logo]').getAttribute('src'), '/shield-mark-light.svg');
        assert.deepEqual(await contrast(page), [], `${width}px ${route} empty form and placeholders`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${route} ${width}: overflow`);
        if (route === '/signup') {
          await page.locator('#first-name').fill('Test'); await page.locator('#last-name').fill('Driver'); await page.locator('#company-name').fill('Fixture company');
        }
        await page.locator('#auth-email').fill('fixture@example.test'); await page.locator('#auth-password').fill('fixture-password');
        await page.locator('#password-toggle').click(); assert.equal(await page.locator('#auth-password').getAttribute('type'), 'text');
        await page.locator('#password-toggle').click(); assert.equal(await page.locator('#auth-password').getAttribute('type'), 'password');
        await page.locator('#auth-submit').click(); assert.equal(await page.locator('#auth-submit').isDisabled(), true);
        assert.deepEqual(await contrast(page), [], `${route} submitting state`);
        await page.evaluate(() => window.finishAuthRequest(true)); await page.waitForFunction(() => document.getElementById('auth-message').classList.contains('error'));
        assert.deepEqual(await contrast(page), [], `${route} error state`);
        if ([1440, 390].includes(width)) await page.screenshot({path: `/private/tmp/deeptruck-${route.slice(1)}-light-${width}.png`, fullPage: true});
        if (route === '/signup') {
          await page.locator('#auth-submit').click(); await page.evaluate(() => window.finishAuthRequest(false));
          await page.waitForFunction(() => document.getElementById('auth-message').textContent.includes('Check your email'));
          assert.deepEqual(await contrast(page), [], `${route} confirmation state`);
        }
        // The same auth page still honors an explicitly chosen dark theme.
        await page.evaluate(() => localStorage.setItem('deeptruck.theme', 'dark')); await page.reload();
        assert.equal(await page.locator('.auth-page').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(9, 11, 14)');
        assert.equal(await page.locator('[data-theme-logo]').getAttribute('src'), '/shield-mark.svg');
        await page.evaluate(() => localStorage.setItem('deeptruck.theme', 'light'));
      }
      console.log(`PASS ${width}px: landing, legal and auth pages, contrast, navigation and saved theme`);
    }
    await page.goto(origin);
    const second = await context.newPage(); await second.goto(origin);
    await page.getByRole('switch', {name: 'Light theme'}).click();
    await second.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    assert.deepEqual(errors, []);
    const blocked = await browser.newContext();
    await blocked.addInitScript(() => {
      Storage.prototype.getItem = () => { throw new Error('Storage unavailable'); };
      Storage.prototype.setItem = () => { throw new Error('Storage unavailable'); };
    });
    await blocked.route(origin + '/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
      return route.fulfill({contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : 'image/svg+xml', body: fs.readFileSync(file)});
    });
    const unavailable = await blocked.newPage(); await unavailable.goto(origin);
    await unavailable.getByRole('switch', {name: 'Light theme'}).click();
    assert.equal(await unavailable.locator('html').getAttribute('data-theme'), 'light', 'switch works when storage is unavailable');
    await blocked.close();
    console.log('PASS typography preserved, hover and keyboard switching, cross-tab sync and storage fallback');
  } finally {
    fs.writeFileSync('/private/tmp/deeptruck-theme-contrast.json', JSON.stringify(reports, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
