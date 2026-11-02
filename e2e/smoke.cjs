// End-to-end check against a production build. Run `npm run build`, then
// `npx vite preview --port 4173`, then: node e2e/smoke.cjs [screenshot-dir]
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:4173/';
const SHOTS = process.argv[2];
const fx = (f) => path.join(__dirname, 'fixtures', f);
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const shot = async (name, p = page) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name + '.png') }); };
  const wait = (ms) => page.waitForTimeout(ms);
  const prose = page.locator('.prose');
  const row = (t) => page.locator('.note-row', { hasText: t });

  // First run
  await page.goto(BASE);
  await page.waitForSelector('.prose');
  await wait(900);
  check('first run opens the welcome note', (await page.inputValue('.doc-title')) === 'Welcome to Clean Notes');
  check('three columns are visible', await page.locator('.sidebar').isVisible() && await page.locator('.list-col').isVisible() && await page.locator('.editor-col').isVisible());
  await shot('01-light-welcome');

  const notesRead = () => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('clean-notes'); r.onsuccess = () => { const q = r.result.transaction('notes').objectStore('notes').getAll(); q.onsuccess = () => { r.result.close(); res(q.result); }; }; }));
  const stamp = (await notesRead())[0].updatedAt;
  await page.reload();
  await page.waitForSelector('.prose');
  await wait(800);
  check('opening a note does not count as an edit', (await notesRead())[0].updatedAt === stamp);

  // New note, title, typing, persistence
  const newNote = async () => {
    await page.getByRole('button', { name: 'New note', exact: true }).first().click();
    await page.waitForFunction(() => document.activeElement?.classList.contains('doc-title') && document.activeElement.value === '');
  };
  await newNote();
  await page.keyboard.type('Field trip');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Plain opening line');
  await page.keyboard.press('Enter');

  // Slash commands
  await page.keyboard.type('/');
  await page.waitForSelector('.slash-menu');
  check('slash menu opens', await page.locator('.slash-menu button').count() >= 10);
  await shot('02-slash');
  await page.keyboard.type('head');
  await wait(60);
  await page.keyboard.press('ArrowDown');
  await wait(60);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second level');
  check('slash heading (arrow + enter picks H2)', await page.locator('.prose h2', { hasText: 'Second level' }).count() === 1);
  await page.keyboard.press('Enter');
  for (const [cmd, sel] of [['/bullet', '.prose ul:not([data-type]) li'], ['/numbered', '.prose ol li']]) {
    await page.keyboard.type(cmd); await wait(60); await page.keyboard.press('Enter');
    await page.keyboard.type('item'); check(`slash ${cmd}`, await page.locator(sel).count() === 1);
    await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  }
  await page.keyboard.type('/quote'); await wait(60); await page.keyboard.press('Enter'); await page.keyboard.type('Quoted');
  check('slash quote', await page.locator('.prose blockquote').count() === 1);
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await page.keyboard.type('/code'); await wait(60); await page.keyboard.press('Enter'); await page.keyboard.type('let a = 1 / 2');
  check('slash code block, and no slash menu inside it', await page.locator('.prose pre').count() === 1 && await page.locator('.slash-menu').count() === 0);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/divider'); await wait(60); await page.keyboard.press('Enter');
  check('slash divider', await page.locator('.prose hr').count() === 1);
  await page.keyboard.type('/table'); await wait(60); await page.keyboard.press('Enter');
  check('slash table', await page.locator('.prose table').count() === 1);
  await page.keyboard.type('/row'); await wait(80); await page.keyboard.press('Enter');
  check('slash in a table adds a row', await page.locator('.prose tr').count() === 4);
  await page.locator('.prose').press('Control+End');
  await wait(50);
  await page.keyboard.type('/nothingmatchesthis'); await wait(60);
  check('slash shows an empty result', await page.locator('.slash-empty').count() === 1);
  await page.keyboard.press('Escape');
  for (let i = 0; i < 19; i++) await page.keyboard.press('Backspace');
  check('slash text removed', !(await prose.innerText()).includes('nothingmatches'));

  // To-dos typed in the editor
  await page.keyboard.type('/todo'); await wait(60); await page.keyboard.press('Enter');
  await page.keyboard.type('Call the supplier');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Order slats');
  await wait(500);
  const ids = await page.locator('.prose li[data-type=taskItem]').evaluateAll((els) => els.map((e) => e.dataset.taskId));
  check('split to-dos get different ids', ids.length === 2 && ids[0] && ids[1] && ids[0] !== ids[1], ids.join(','));

  // Bubble menu
  await page.locator('.prose p', { hasText: 'Plain opening line' }).click({ clickCount: 3 });
  await page.waitForSelector('.format-menu');
  await shot('03-format');
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  check('format menu applies bold and highlight', await page.locator('.prose strong mark, .prose mark strong').count() === 1);
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await page.getByLabel('Link address').fill('example.com');
  await page.keyboard.press('Enter');
  check('link gets a protocol', (await page.locator('.prose a').first().getAttribute('href')) === 'https://example.com');
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await page.getByLabel('Link address').fill('javascript:alert(1)');
  await page.keyboard.press('Enter');
  check('javascript: links are refused', !(await prose.innerHTML()).includes('javascript:'));

  // Tags
  await wait(200);
  const tagBox = page.getByLabel('Add tag');
  await tagBox.fill('Work/Clients/Acme');
  await tagBox.press('Enter');
  await tagBox.fill('work/ideas');
  await tagBox.press('Enter');
  await wait(150);
  check('tags normalize into nested paths', await page.locator('.tag-chip').count() === 2 && (await page.locator('.tag-chip').first().innerText()).replace(/\s/g, '') === 'work/clients/acme');
  check('tag tree nests', await page.locator('.nav-row', { hasText: 'acme' }).count() === 1 && await page.locator('.nav-row', { hasText: 'clients' }).count() === 1);
  const workRow = page.locator('.nav-row').filter({ has: page.locator('.nav-label', { hasText: /^work$/ }) });
  check('parent tag counts the note once', (await workRow.locator('.nav-count').innerText()) === '1');
  await workRow.locator('.nav-main').click();
  await wait(100);
  check('parent tag lists the nested note', await row('Field trip').count() === 1);
  await page.locator('.nav-row', { hasText: 'clients' }).locator('.tag-chevron').click();
  check('tag tree collapses', await page.locator('.nav-row', { hasText: 'acme' }).count() === 0);
  await page.locator('.nav-row', { hasText: 'clients' }).locator('.tag-chevron').click();
  await page.locator('.tag-chip-go').first().click();
  check('clicking a chip opens that tag', (await page.locator('.list-head h1').innerText()) === '#work/clients/acme');

  // Rename a tag subtree
  const clients = page.locator('.nav-row', { hasText: 'clients' });
  await clients.hover();
  await clients.getByRole('button', { name: /Actions for tag/ }).click();
  await page.getByRole('menuitem', { name: 'Rename or move' }).click();
  await page.getByLabel('Tag path').fill('customers');
  await page.keyboard.press('Enter');
  await wait(200);
  check('renaming moves the subtree and the view follows', (await page.locator('.list-head h1').innerText()) === '#customers/acme');

  // Notebooks
  await page.getByRole('button', { name: 'New notebook' }).click();
  await page.getByLabel('Name').fill('Patras');
  await page.keyboard.press('Enter');
  await wait(200);
  check('notebook created and opened', (await page.locator('.list-head h1').innerText()) === 'Patras');
  await newNote();
  await page.keyboard.type('In notebook');
  await page.locator('.nav-row', { hasText: 'All notes' }).locator('.nav-main').click();
  await wait(150);
  check('a title typed just before switching away is saved', await row('In notebook').count() === 1);
  await page.locator('.nav-row', { hasText: 'Patras' }).locator('.nav-main').click();
  await wait(150);
  check('new note lands in the current notebook', await row('In notebook').count() === 1);
  await page.locator('.nav-row', { hasText: 'All notes' }).locator('.nav-main').click();
  await wait(100);
  await row('Field trip').dragTo(page.locator('.nav-row', { hasText: 'Patras' }));
  await wait(200);
  check('dragging a note into a notebook moves it', (await page.locator('.nav-row', { hasText: 'Patras' }).locator('.nav-count').innerText()) === '2');

  // Daily notes
  await page.locator('.nav-row', { hasText: 'Today' }).locator('.nav-main').click();
  await page.waitForSelector('.calendar');
  await wait(250);
  const dailyTitle = await page.inputValue('.doc-title');
  check('Today opens a dated note', dailyTitle.includes(String(new Date().getFullYear())), dailyTitle);
  check('daily title is locked', await page.locator('.doc-title').getAttribute('readonly') !== null);
  await page.locator('.prose').click();
  await page.keyboard.type('Morning thoughts καλημέρα');
  await wait(500);
  check('calendar marks today', await page.locator('.calendar-grid button[data-today=true][data-has=true]').count() === 1);
  const doc1 = await page.inputValue('.doc-title');
  await page.locator('.doc-daily-nav').getByRole('button', { name: 'Previous day' }).click();
  await wait(250);
  check('previous day opens another note', (await page.inputValue('.doc-title')) !== doc1 && (await prose.innerText()).trim() === '');
  await shot('04-daily');
  await page.locator('.doc-daily-nav').getByRole('button', { name: 'Next day' }).click();
  await wait(250);
  check('returning shows the earlier text', (await prose.innerText()).includes('Morning thoughts'));
  await page.locator('.nav-row', { hasText: 'Today' }).locator('.nav-main').click();
  await wait(250);
  check('opening Today twice does not duplicate it', await page.locator('.note-row', { hasText: 'Morning thoughts' }).count() === 1);

  // Tasks
  await page.locator('.nav-row', { hasText: 'Tasks' }).locator('.nav-main').click();
  await wait(150);
  check('Tasks collects to-dos from notes', await page.locator('.task-row', { hasText: 'Call the supplier' }).count() === 1 && await page.locator('.task-row', { hasText: 'Tick this one off' }).count() === 1);
  await page.getByLabel('New task', { exact: true }).fill('Quick added');
  await page.keyboard.press('Enter');
  await wait(250);
  check('quick add creates a task', await page.locator('.task-row', { hasText: 'Quick added' }).count() === 1);
  await page.locator('.task-row', { hasText: 'Quick added' }).locator('.task-row-main').click();
  await wait(300);
  check('quick add went into today\'s note', (await prose.innerText()).includes('Quick added') && (await prose.innerText()).includes('Morning thoughts'));
  // Toggling from the list updates the open editor
  await page.locator('.task-row', { hasText: 'Quick added' }).locator('input[type=checkbox]').click({ force: true });
  await wait(300);
  check('checking in Tasks updates the open note', await page.locator('.prose li[data-type=taskItem][data-checked=true]', { hasText: 'Quick added' }).count() === 1);
  check('completed task leaves the open groups', await page.locator('.task-row', { hasText: 'Quick added' }).count() === 0);
  // Editor edits flow back, with pending keystrokes preserved by flush
  await page.locator('.prose li', { hasText: 'Quick added' }).locator('.task-content').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' now');
  await page.locator('.task-row', { hasText: 'Tick this one off' }).locator('input[type=checkbox]').click({ force: true });
  await wait(450);
  check('unsaved typing survives a task toggle', (await prose.innerText()).includes('Quick added now'));
  await page.locator('.task-done-toggle').click();
  check('completed section expands', await page.locator('.task-row', { hasText: 'Quick added now' }).count() === 1);
  // Date set from Tasks view
  const dated = page.locator('.task-row', { hasText: 'Install the app' });
  await dated.locator('input[type=date]').fill('2020-01-15');
  await wait(250);
  check('past due date goes to Overdue', await page.locator('.task-group', { hasText: 'Overdue' }).locator('.task-row', { hasText: 'Install the app' }).count() === 1);
  await shot('05-tasks');
  await dated.locator('.task-row-main').click();
  await wait(300);
  check('opening a task lands on its note', (await page.inputValue('.doc-title')) === 'Welcome to Clean Notes');
  check('due chip appears in the note', (await page.locator('.prose li', { hasText: 'Install the app' }).locator('.task-due').getAttribute('data-late')) === 'true');
  // Checkbox in editor flows to Tasks
  await page.locator('.prose li', { hasText: 'Install the app' }).locator('.task-check input').check({ force: true });
  await wait(500);
  check('checking in a note updates Tasks', await page.locator('.task-group', { hasText: 'Overdue' }).count() === 0);

  // PDF: attach through the slash command
  await page.locator('.nav-row', { hasText: 'All notes' }).locator('.nav-main').click();
  await row('Field trip').locator('.note-row-main').click();
  await wait(250);
  await page.locator('.prose').press('Control+End');
  await page.keyboard.press('Enter');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    (async () => { await page.keyboard.type('/pdf'); await wait(60); await page.keyboard.press('Enter'); })(),
  ]);
  await chooser.setFiles(fx('sample.pdf'));
  await page.waitForSelector('.pdf-card');
  await wait(500);
  check('PDF block shows pages and a thumbnail', (await page.locator('.pdf-card').innerText()).includes('3 pages') && await page.locator('.pdf-card img').count() === 1);
  await shot('06-pdf-card');
  await page.locator('.pdf-card').click();
  await page.waitForSelector('.pdf-page canvas');
  await wait(900);
  check('viewer renders pages', await page.locator('.pdf-page').count() === 3);
  check('canvas is painted', await page.locator('.pdf-page canvas').first().evaluate((c) => c.width > 100));
  check('text layer is selectable', (await page.locator('.pdf-page').first().locator('.textLayer').innerText()).includes('Quarterly field report'));
  const spanBox = await page.locator('.textLayer span', { hasText: 'Quarterly' }).first().boundingBox();
  check('text layer lines up with the page', spanBox && spanBox.width > 100 && spanBox.height > 10, JSON.stringify(spanBox));
  check('split view keeps the note alongside on a wide screen', await page.locator('.doc-pane').isVisible() && (await page.locator('.pdf-pane').boundingBox()).x > 700);
  await shot('07-pdf-split');
  // In-PDF search
  await page.getByRole('button', { name: 'Search in PDF' }).click();
  await page.getByLabel('Find in this PDF').fill('surveyor');
  await wait(500);
  check('PDF search counts matches', (await page.locator('.pdf-search-count').innerText()) === '1 of 3', await page.locator('.pdf-search-count').innerText());
  const hl = await page.evaluate(() => [CSS.highlights.get('pdf-match')?.size, CSS.highlights.get('pdf-match-current')?.size]);
  check('PDF search highlights', hl[1] === 1, JSON.stringify(hl));
  await page.keyboard.press('Enter');
  await wait(600);
  check('next match moves to page 2', (await page.getByLabel('Page number').inputValue()) === '2' && (await page.locator('.pdf-search-count').innerText()) === '2 of 3');
  await shot('08-pdf-search');
  await page.getByLabel('Find in this PDF').fill('zzzz');
  await wait(100);
  check('PDF search reports no matches', (await page.locator('.pdf-search-count').innerText()) === 'No matches');
  await page.keyboard.press('Escape');
  // Zoom, page jump, download
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await wait(500);
  const widthA = (await page.locator('.pdf-page').first().boundingBox()).width;
  await page.getByRole('button', { name: /Fit to width/ }).click();
  await wait(500);
  const widthB = (await page.locator('.pdf-page').first().boundingBox()).width;
  check('zoom in, then back to fit', widthA > widthB * 1.1, `${widthA} vs ${widthB}`);
  await page.getByLabel('Page number').fill('3');
  await page.keyboard.press('Enter');
  await wait(400);
  check('page jump', (await page.getByLabel('Page number').inputValue()) === '3');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()]);
  check('download keeps the file name', dl.suggestedFilename() === 'sample.pdf');
  await page.getByRole('button', { name: 'Close PDF' }).click();

  // Broken and password-protected files via drop
  const drop = async (file, mime) => {
    const fs = require('fs');
    const b64 = fs.readFileSync(fx(file)).toString('base64');
    await page.evaluate(async ({ b64, file, mime }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], file, { type: mime }));
      const el = document.querySelector('.prose');
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 20, clientY: r.bottom - 10 }));
    }, { b64, file, mime });
  };
  await drop('broken.pdf', 'application/pdf');
  await wait(800);
  check('corrupt PDF is refused with a message', (await page.locator('.toast').innerText()).includes('could not be read'));
  check('corrupt PDF adds nothing', await page.locator('.pdf-card').count() === 1);
  await drop('locked.pdf', 'application/pdf');
  await page.waitForFunction(() => document.querySelectorAll('.pdf-card').length === 2);
  await wait(300);
  await page.locator('.pdf-card', { hasText: 'locked.pdf' }).click();
  await page.waitForSelector('.pdf-password');
  await page.getByLabel('PDF password').fill('nope');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.pdf-password [role=alert]');
  check('wrong password is reported', true);
  await page.getByLabel('PDF password').fill('secret');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.pdf-page canvas');
  await wait(600);
  check('correct password unlocks the PDF', await page.locator('.pdf-page').count() === 3);
  check('a PDF dropped at the end leaves the cursor in text', await page.locator('.prose .ProseMirror-selectednode').count() === 0);
  await page.getByRole('button', { name: 'Close PDF' }).click();

  // Images: slash command, display, sizing, description
  await row('Field trip').count();
  await page.locator('.prose').press('Control+End');
  const [imgChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    (async () => { await page.keyboard.type('/image'); await wait(80); await page.keyboard.press('Enter'); })(),
  ]);
  check('the image picker asks for images', imgChooser.isMultiple());
  await imgChooser.setFiles(fx('photo.jpg'));
  await page.waitForSelector('.image-frame img');
  await wait(400);
  const shown = page.locator('.image-frame img').first();
  check('image displays', await shown.evaluate((i) => i.complete && i.naturalWidth === 1600));
  check('image leaves the cursor in text', await page.locator('.prose .ProseMirror-selectednode').count() === 0);
  await page.keyboard.type('After the image');
  check('typing continues below the image', (await page.locator('.node-noteImage + p').first().innerText()).includes('After the image'));
  await shown.click();
  await page.waitForSelector('.image-tools');
  await page.locator('.image-node').first().scrollIntoViewIfNeeded();
  await wait(150);
  await shot('18-image-selected');
  check('image toolbar appears when selected', await page.locator('.image-handle').count() === 1);
  await page.keyboard.type('x');
  await wait(100);
  check('typing with an image selected keeps the image', await page.locator('.image-frame').count() === 1 && (await prose.innerText()).includes('xAfter the image'));
  await page.keyboard.press('Backspace');
  await wait(600); // so the next click is not read as a double click
  await shown.click();
  await page.getByRole('button', { name: 'Small', exact: true }).click();
  await wait(100);
  const col = (await page.locator('.image-node').first().boundingBox()).width;
  const small = (await page.locator('.image-frame').first().boundingBox()).width;
  check('size preset applies', Math.abs(small / col - 0.33) < 0.02, (small / col).toFixed(2));
  const hb = await page.locator('.image-handle').boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + col * 0.3, hb.y + 10, { steps: 6 });
  await page.mouse.up();
  await wait(150);
  const dragged = (await page.locator('.image-frame').first().boundingBox()).width;
  check('dragging the handle resizes', Math.abs(dragged / col - 0.63) < 0.05, (dragged / col).toFixed(2));
  const ratio = await page.locator('.image-frame').first().evaluate((f) => f.offsetWidth / f.offsetHeight);
  check('aspect ratio is kept', Math.abs(ratio - 16 / 9) < 0.03, ratio.toFixed(3));
  await page.getByRole('button', { name: 'Left, text beside it', exact: true }).click();
  await wait(150);
  const floated = page.locator('.prose > .node-noteImage').first();
  const floatW = (await page.locator('.image-frame').first().boundingBox()).width;
  check('image floats left at side-by-side width', (await floated.getAttribute('data-align')) === 'left' && Math.abs(floatW / col - 0.45) < 0.03, (floatW / col).toFixed(2));
  await page.getByRole('button', { name: 'On its own line', exact: true }).click();
  await wait(150);
  check('image goes back on its own line', (await floated.getAttribute('data-align')) === 'none');
  await page.getByRole('button', { name: 'Describe image' }).click();
  await page.getByLabel('Description').fill('Sunset over the zebrafish quay');
  await page.keyboard.press('Enter');
  await wait(100);
  check('description sets the alt text', (await shown.getAttribute('alt')) === 'Sunset over the zebrafish quay');
  await page.locator('.image-frame').first().click();
  await page.getByRole('button', { name: 'View full size' }).click();
  await page.waitForSelector('.lightbox img');
  await wait(200);
  await shot('19-image-lightbox');
  check('full-size view opens', await page.locator('.lightbox img').evaluate((i) => i.clientWidth > 900));
  await page.keyboard.press('Escape');
  await wait(100);
  check('Escape closes the full-size view', await page.locator('.lightbox').count() === 0);
  await page.locator('.image-frame').first().click();
  const [imgDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download image' }).click()]);
  check('image download keeps its name', imgDl.suggestedFilename() === 'photo.jpg');

  // Images: drop, paste, order, bad files
  await page.locator('.prose').press('Control+End');
  await drop('small.png', 'image/png');
  await page.waitForFunction(() => document.querySelectorAll('.image-frame').length === 2);
  await wait(300);
  const smallFrame = page.locator('.image-frame').nth(1);
  const smallW = (await smallFrame.boundingBox()).width;
  check('small images keep a modest size', smallW < 160, String(smallW));
  await drop('broken.png', 'image/png');
  await wait(500);
  check('an unreadable image is refused with a message', (await page.locator('.toast').innerText()).includes('could not be read') && await page.locator('.image-frame').count() === 2);
  const paste = async (file, mime, plain) => {
    const b64 = require('fs').readFileSync(fx(file)).toString('base64');
    await page.evaluate(({ b64, file, mime, plain }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], file, { type: mime }));
      if (plain) dt.setData('text/plain', plain);
      document.querySelector('.prose').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    }, { b64, file, mime, plain });
  };
  await page.locator('.prose').press('Control+End');
  await paste('anim.gif', 'image/gif');
  await page.waitForFunction(() => document.querySelectorAll('.image-frame').length === 3);
  await wait(300);
  check('pasting a picture adds it', true);
  const gifType = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('clean-notes'); r.onsuccess = () => { const q = r.result.transaction('images').objectStore('images').getAll(); q.onsuccess = () => { r.result.close(); res(q.result.map((i) => i.blob.type)); }; }; }));
  check('animated GIFs are stored as they are', gifType.includes('image/gif'), gifType.join());
  await page.locator('.prose').press('Control+End');
  await paste('small.png', 'image/png', 'Spreadsheet cells');
  await wait(400);
  check('text with a clipboard picture pastes as text', await page.locator('.image-frame').count() === 3);
  await page.evaluate(() => document.querySelector('.doc-scroll').scrollTop = 0);
  await wait(400);

  // Global search
  const search = page.getByLabel('Search notes and PDFs');
  await page.keyboard.press('Control+k');
  check('Ctrl K focuses search', await search.evaluate((e) => e === document.activeElement));
  await search.fill('ΚΑΛΗΜΕΡΑ');
  await wait(150);
  check('search ignores case and Greek accents', await page.locator('.note-row', { hasText: 'Morning thoughts' }).count() === 1 && await page.locator('.note-row mark', { hasText: 'καλημέρα' }).count() === 1);
  await search.fill('primer');
  await wait(150);
  check('search finds text inside PDFs', await page.locator('.note-row', { hasText: 'sample.pdf' }).locator('em', { hasText: 'Page 2' }).count() === 1);
  await shot('09-search');
  await page.locator('.note-row', { hasText: 'sample.pdf' }).locator('.note-row-main').click();
  await page.waitForSelector('.pdf-page canvas');
  await wait(900);
  check('a PDF hit opens at its page', (await page.getByLabel('Page number').inputValue()) === '2', await page.getByLabel('Page number').inputValue());
  check('a PDF hit carries the search over', (await page.getByLabel('Find in this PDF').inputValue()) === 'primer');
  await page.getByRole('button', { name: 'Close PDF' }).click();
  await search.fill('zebrafish');
  await wait(150);
  check('search finds image descriptions', await page.locator('.note-row', { hasText: 'Field trip' }).count() === 1);
  await search.fill('qqqqq');
  await wait(100);
  check('search shows an empty state', await page.getByText('Nothing found').count() === 1);
  await search.fill('');

  // PDFs view
  await page.locator('.nav-row', { hasText: 'PDFs' }).locator('.nav-main').click();
  await wait(150);
  check('PDFs view lists both files', await page.locator('.pdf-row').count() === 2);
  await page.locator('.nav-row', { hasText: 'All notes' }).locator('.nav-main').click();

  // Persistence across reload
  await row('Field trip').locator('.note-row-main').click();
  await wait(250);
  await page.locator('.prose').press('Control+End');
  await page.keyboard.type('Saved immediately');
  await page.reload();
  await page.waitForSelector('.prose');
  await wait(500);
  check('typing just before a reload is saved', (await prose.innerText()).includes('Saved immediately'));
  check('images survive a reload', await page.locator('.image-frame img').count() === 3 && await page.locator('.image-frame img').first().evaluate(async (i) => { await i.decode(); return i.naturalWidth === 1600; }));
  check('image size survives a reload', Math.abs((await page.locator('.image-frame').first().boundingBox()).width / (await page.locator('.image-node').first().boundingBox()).width - 0.45) < 0.05);
  check('rich content survives a reload', await page.locator('.prose table').count() === 1 && await page.locator('.prose h2').count() === 1 && await page.locator('.pdf-card').count() === 2);

  // Trash, undo, restore, delete forever and file cleanup
  await page.getByRole('button', { name: 'Note actions' }).click();
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await wait(200);
  await page.locator('.toast button').click();
  await wait(200);
  check('undo restores a trashed note', await row('Field trip').count() === 1);
  await row('Field trip').locator('.note-row-main').click();
  await wait(200);
  await page.getByRole('button', { name: 'Note actions' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await wait(300);
  check('duplicate opens a copy', (await page.inputValue('.doc-title')) === 'Field trip copy');
  const taskCount = await page.locator('.nav-row', { hasText: 'Tasks' }).locator('.nav-count').innerText();
  check('duplicated to-dos count as separate tasks', Number(taskCount) >= 4, taskCount);
  await page.getByRole('button', { name: 'Note actions' }).click();
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await wait(150);
  await page.locator('.nav-row', { hasText: 'Trash' }).locator('.nav-main').click();
  await wait(150);
  await row('Field trip copy').locator('.note-row-main').click();
  await wait(200);
  check('trashed note is read-only', (await page.locator('.prose').getAttribute('contenteditable')) === 'false');
  await page.locator('.doc-bar').getByRole('button', { name: 'Delete' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await wait(300);
  const fileCount = () => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('clean-notes'); r.onsuccess = () => { const q = r.result.transaction('blobs').objectStore('blobs').count(); q.onsuccess = () => { r.result.close(); res(q.result); }; }; }));
  const imageCount = () => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('clean-notes'); r.onsuccess = () => { const q = r.result.transaction('images').objectStore('images').count(); q.onsuccess = () => { r.result.close(); res(q.result); }; }; }));
  check('images still used by another note are kept', (await imageCount()) === 3, String(await imageCount()));
  check('files still used by another note are kept', (await fileCount()) === 2, String(await fileCount()));

  // Backup and restore
  await page.getByRole('button', { name: 'Settings' }).click();
  await shot('10-settings');
  const [bk] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export backup' }).click()]);
  const bkPath = await bk.path();
  const backup = JSON.parse(require('fs').readFileSync(bkPath, 'utf8'));
  check('backup holds notes, notebooks and PDF bytes', backup.notes.length >= 3 && backup.notebooks.length === 2 && backup.blobs.length === 2 && backup.blobs[0].data.length > 500);
  check('backup holds image bytes', backup.images.length === 3 && backup.images.every((i) => i.data.length > 50 && i.type.startsWith('image/')));
  const before = await page.locator('.nav-row', { hasText: 'All notes' }).locator('.nav-count').innerText();
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE);
  await p2.waitForSelector('.prose');
  await p2.getByRole('button', { name: 'Settings' }).click();
  await p2.getByLabel('Backup file').setInputFiles(bkPath);
  await p2.waitForSelector('.toast');
  await p2.waitForTimeout(400);
  check('backup restores on a fresh browser', (await p2.locator('.toast').innerText()).startsWith('Restored'), await p2.locator('.toast').innerText());
  await p2.getByRole('button', { name: 'Close' }).click();
  await p2.locator('.note-row', { hasText: 'Field trip' }).locator('.note-row-main').click();
  await p2.waitForTimeout(300);
  await p2.locator('.pdf-card', { hasText: 'sample.pdf' }).click();
  await p2.waitForSelector('.pdf-page canvas');
  check('restored PDFs open', await p2.locator('.pdf-page').count() === 3);
  await p2.getByRole('button', { name: 'Close PDF' }).click();
  check('restored images display', await p2.locator('.image-frame img').first().evaluate(async (i) => { await i.decode(); return i.naturalWidth === 1600; }));
  await ctx2.close();
  // A backup made before images existed still restores.
  const oldBackup = { ...backup, version: 1 };
  delete oldBackup.images;
  await page.getByLabel('Backup file').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(oldBackup)) });
  await wait(300);
  check('older backups still restore', (await page.locator('.toast').innerText()).startsWith('Restored'), await page.locator('.toast').innerText());
  await page.getByLabel('Backup file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"other"}') });
  await wait(200);
  check('a wrong backup file is refused', (await page.locator('.toast').innerText()).includes('not a Clean Notes backup'));
  check('refused restore changes nothing', (await page.locator('.nav-row', { hasText: 'All notes' }).locator('.nav-count').innerText()) === before);
  await page.locator('dialog').getByRole('button', { name: 'Close' }).click();

  // Themes
  await page.locator('.nav-row', { hasText: 'All notes' }).locator('.nav-main').click();
  await row('Welcome').locator('.note-row-main').click();
  await wait(250);
  await page.getByRole('button', { name: /^Theme:/ }).click();
  await page.getByRole('button', { name: /^Theme:/ }).click();
  check('dark theme applies', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  await wait(300);
  await shot('11-dark');
  await page.reload();
  await page.waitForSelector('.prose');
  check('theme survives a reload', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  await row('Field trip').locator('.note-row-main').click();
  await wait(300);
  await page.locator('.pdf-card', { hasText: 'sample.pdf' }).click();
  await page.waitForSelector('.pdf-page canvas');
  await wait(700);
  await shot('12-dark-pdf');
  await page.getByRole('button', { name: 'Close PDF' }).click();

  // Focus mode, resizing, tag deletion, notebook deletion
  await page.keyboard.press('Control+\\');
  await wait(400);
  check('focus mode hides the side columns', !(await page.locator('.sidebar').isVisible()));
  await shot('13-focus');
  await page.keyboard.press('Control+\\');
  await wait(400);
  const rz = page.locator('.resizer').nth(1);
  const a = (await page.locator('.list-col').boundingBox()).width;
  await rz.focus();
  await page.keyboard.press('ArrowRight');
  await wait(350);
  check('columns resize', (await page.locator('.list-col').boundingBox()).width > a);
  const nb = page.locator('.nav-row', { hasText: 'Patras' });
  await nb.hover();
  await nb.getByRole('button', { name: 'Actions for Patras' }).click();
  await page.getByRole('menuitem', { name: 'Delete notebook' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Delete notebook' }).click();
  await wait(250);
  check('deleting a notebook keeps its notes', await page.locator('.nav-row', { hasText: 'Patras' }).count() === 0 && await row('In notebook').count() === 1);

  // Offline
  const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return Boolean(r.active); });
  check('service worker is active', reg);
  await page.waitForTimeout(1500);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('.prose, .blank-state');
  await wait(500);
  check('app loads offline', await page.locator('.sidebar').count() === 1);
  await row('Field trip').locator('.note-row-main').click();
  await wait(300);
  await page.locator('.pdf-card', { hasText: 'sample.pdf' }).click();
  await page.waitForSelector('.pdf-page canvas');
  await wait(800);
  check('PDFs open offline', (await page.locator('.pdf-page').first().locator('.textLayer').innerText()).includes('Quarterly'));
  const manifest = await page.evaluate(() => document.querySelector('link[rel=manifest]')?.getAttribute('href'));
  check('manifest is linked', Boolean(manifest), manifest);
  await ctx.setOffline(false);
  const errs = errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e));
  check('no errors in the console', errs.length === 0, errs.slice(0, 6).join(' | '));
  await ctx.close();

  // Upgrading a database from the first release keeps everything
  const up = await browser.newContext();
  const u = await up.newPage();
  await u.goto(BASE + 'icons/icon.svg');
  await u.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('clean-notes', 10);
    r.onupgradeneeded = () => {
      const d = r.result;
      const notes = d.createObjectStore('notes', { keyPath: 'id' });
      for (const i of ['updatedAt', 'notebookId', 'kind', 'date', 'trashedAt']) notes.createIndex(i, i);
      notes.createIndex('tags', 'tags', { multiEntry: true });
      d.createObjectStore('notebooks', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      d.createObjectStore('files', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      d.createObjectStore('blobs', { keyPath: 'id' });
    };
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const t = r.result.transaction('notes', 'readwrite');
      t.objectStore('notes').put({ id: 'old1', title: 'From version one', text: 'Old body', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Old body' }] }] }, notebookId: null, tags: [], kind: 'note', pinned: false, createdAt: 1, updatedAt: 1, trashedAt: null });
      t.oncomplete = () => { r.result.close(); res(); };
    };
  }));
  await u.goto(BASE);
  await u.waitForSelector('.note-row');
  await u.waitForTimeout(400);
  check('an existing database upgrades with notes intact', await u.locator('.note-row', { hasText: 'From version one' }).count() === 1);
  await u.locator('.note-row', { hasText: 'From version one' }).locator('.note-row-main').click();
  await u.waitForFunction(() => document.querySelector('.doc-title')?.value === 'From version one');
  await u.waitForTimeout(150);
  await u.locator('.prose').press('Control+End');
  await u.keyboard.press('Enter');
  await u.keyboard.type('/image');
  await u.waitForTimeout(80);
  const [uc] = await Promise.all([u.waitForEvent('filechooser'), u.keyboard.press('Enter')]);
  await uc.setFiles(fx('small.png'));
  await u.waitForSelector('.image-frame img');
  check('an upgraded database can store images', true);
  await up.close();

  // Phone
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'dark' });
  const m = await phone.newPage();
  await m.goto(BASE);
  await m.waitForSelector('.list-col');
  await m.waitForTimeout(600);
  const overflow = async () => m.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  check('phone starts on the list', await m.locator('.list-col').isVisible() && !(await m.locator('.editor-col').isVisible()));
  check('phone has no sideways scroll', !(await overflow()));
  if (SHOTS) await m.screenshot({ path: path.join(SHOTS, '14-phone-list.png') });
  await m.locator('.note-row-main').first().click();
  await m.waitForTimeout(300);
  check('phone opens the editor full width', await m.locator('.editor-col').isVisible() && !(await m.locator('.list-col').isVisible()));
  check('phone shows the note title', (await m.locator('.doc-title').boundingBox()).height > 24);
  if (SHOTS) await m.screenshot({ path: path.join(SHOTS, '15-phone-note.png') });
  await m.goBack();
  await m.waitForTimeout(250);
  check('phone back button returns to the list', await m.locator('.list-col').isVisible());
  await m.getByRole('button', { name: 'Open library' }).click();
  await m.waitForTimeout(350);
  check('phone library opens as a drawer', await m.locator('.sidebar').isVisible());
  check('phone drawer does not scroll sideways', !(await overflow()));
  if (SHOTS) await m.screenshot({ path: path.join(SHOTS, '16-phone-drawer.png') });
  await m.locator('.nav-row', { hasText: 'Tasks' }).locator('.nav-main').click();
  await m.waitForTimeout(350);
  check('choosing a view closes the drawer', !(await m.locator('.sidebar').isVisible()) && (await m.locator('.list-head h1').innerText()) === 'Tasks');
  await phone.close();

  // Tablet
  const tab = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const t = await tab.newPage();
  await t.goto(BASE);
  await t.waitForSelector('.prose');
  await t.waitForTimeout(500);
  check('tablet shows list and editor', await t.locator('.list-col').isVisible() && await t.locator('.editor-col').isVisible() && !(await t.locator('.sidebar').isVisible()));
  if (SHOTS) await t.screenshot({ path: path.join(SHOTS, '17-tablet.png') });
  await tab.close();

  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); console.log('FAILED with', results.filter(Boolean).length, 'passed so far'); process.exit(2); });
