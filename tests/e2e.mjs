// Ponta a ponta no Chromium: carrega o mapa, procura a base mais próxima de uma obra
// em Salvador, testa filtro e entrada inválida. Uso: node tests/e2e.mjs [pasta-capturas]
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const raiz = resolve(new URL('..', import.meta.url).pathname);
const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const srv = createServer(async (req, res) => {
  try {
    const p = join(raiz, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    res.writeHead(200, { 'content-type': tipos[extname(p)] || 'application/octet-stream' });
    res.end(await readFile(p));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const url = `http://localhost:${srv.address().port}/`;
const saida = process.argv[2] || '.';
const browser = await chromium.launch();
const erros = [];
try {
  for (const [nome, vp] of [['desktop', { width: 1366, height: 800 }], ['celular', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport: vp });
    page.on('pageerror', (e) => erros.push(`${nome}: ${e.message}`));
    // bloqueia os tiles externos (o teste não depende de internet)
    await page.route(/tile\.openstreetmap\.org/, (r) => r.abort());
    // usa sempre a mesma amostra fixa (o data/rbmc.json real muda todo dia)
    await page.route(/data\/rbmc\.json/, async (r) => r.fulfill({ contentType: 'application/json',
      body: await readFile(join(raiz, 'tests/fixtures/rbmc-amostra.json')) }));
    await page.goto(url);
    await page.waitForFunction(() => window.__pronto === true);
    await page.fill('#coord', '-12.9714, -38.5014');
    await page.click('#busca button[type=submit]');
    await page.waitForFunction(() => window.__rbmc?.proximas?.length > 0);
    const r = await page.evaluate(() => window.__rbmc.proximas.map((e) => [e.id, +e.km.toFixed(2)]));
    if (r[0][0] !== 'SSA1' || r[0][1] > 2) throw new Error(`${nome}: base mais próxima errada ${JSON.stringify(r)}`);
    const itens = await page.locator('#lista li').count();
    if (itens !== 5) throw new Error(`${nome}: lista com ${itens} itens`);
    // "só ativas" desmarcado deve incluir estações paradas (SAVO, SALV)
    await page.uncheck('#soAtivas');
    const todos = await page.evaluate(() => window.__rbmc.proximas.map((e) => e.id));
    if (!todos.includes('SAVO')) throw new Error('filtro só ativas não funcionou');
    await page.check('#soAtivas');
    // entrada inválida
    await page.fill('#coord', 'Salvador');
    await page.click('#busca button[type=submit]');
    if (!(await page.locator('#erro').textContent()).includes('Formato')) throw new Error('erro não exibido');
    // busca por texto
    await page.fill('#filtro', 'sergipe');
    await page.waitForTimeout(300);
    const resumo = await page.locator('#resumo').textContent();
    if (!resumo.startsWith('1 no mapa')) throw new Error(`filtro de texto: ${resumo}`);
    await page.fill('#filtro', '');
    await page.fill('#coord', '-12.9714, -38.5014');
    await page.click('#busca button[type=submit]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(saida, `rbmc-${nome}.png`) });
    console.log(nome, 'ok', JSON.stringify(r.slice(0, 3)));
    await page.close();
  }
} finally {
  await browser.close();
  srv.close();
}
if (erros.length) { console.error(erros.join('\n')); process.exit(1); }
