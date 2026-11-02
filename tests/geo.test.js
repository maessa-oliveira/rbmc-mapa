import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inverso, maisProximas, situacao, orientacao, lerCoordenada, dms } from '../src/geo.js';

const perto = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (tol ${tol})`);

test('Vincenty: caso clássico Flinders Peak -> Buninyong (adaptado a GRS80)', () => {
  // Valor de referência do GeographicLib para GRS80: 54 972,271 m; azimute 306°52'05,37"
  const r = inverso(-37.95103342, 144.42486789, -37.65282114, 143.92649554);
  perto(r.distancia, 54972.271, 0.005);
  perto(r.azimute, 306 + 52 / 60 + 5.37 / 3600, 1e-5);
});

test('Vincenty: 1 grau de latitude no equador ≈ 110 574 m', () => {
  perto(inverso(0, -40, 1, -40).distancia, 110574.4, 1);
});

test('mesmo ponto -> distância zero', () => {
  assert.equal(inverso(-12, -38, -12, -38).distancia, 0);
});

const estacoes = [
  { id: 'SSA1', lat: -12.97516, lon: -38.51648, dias_com_dados: 7 },
  { id: 'SAVO', lat: -12.93925, lon: -38.43225, dias_com_dados: 0 },
  { id: 'BAIT', lat: -12.52135, lon: -40.28866, dias_com_dados: 7 },
];

test('mais próximas: ordena por distância e respeita o filtro', () => {
  const r = maisProximas(estacoes, -12.98, -38.50, 2);
  assert.deepEqual(r.map((e) => e.id), ['SSA1', 'SAVO']);
  assert.ok(r[0].km < 2);
  const so = maisProximas(estacoes, -12.98, -38.50, 2, (e) => e.dias_com_dados > 0);
  assert.deepEqual(so.map((e) => e.id), ['SSA1', 'BAIT']);
});

test('situação da estação', () => {
  assert.equal(situacao({ dias_com_dados: 7 }).chave, 'ativa');
  assert.equal(situacao({ dias_com_dados: 6 }).chave, 'ativa');
  assert.equal(situacao({ dias_com_dados: 3 }).chave, 'instavel');
  assert.equal(situacao({ dias_com_dados: 0 }).chave, 'parada');
});

test('orientação por distância', () => {
  assert.equal(orientacao(12).nivel, 'bom');
  assert.equal(orientacao(35).nivel, 'atencao');
  assert.equal(orientacao(120).nivel, 'longe');
});

test('lê coordenadas decimais e DMS', () => {
  assert.deepEqual(lerCoordenada('-12.9714, -38.5014'), { lat: -12.9714, lon: -38.5014 });
  assert.deepEqual(lerCoordenada('-12,9714 -38,5014'), { lat: -12.9714, lon: -38.5014 });
  const d = lerCoordenada(`12°58'17"S 38°30'05"W`);
  perto(d.lat, -12.971389, 1e-6);
  perto(d.lon, -38.501389, 1e-6);
  assert.throws(() => lerCoordenada('Salvador'));
  assert.throws(() => lerCoordenada('-120, 10'));
});

test('formata DMS', () => {
  assert.equal(dms(-12.971389, 'lat'), `12°58'17,00"S`);
  assert.equal(dms(-38.5, 'lon'), `38°30'00,00"W`);
});
