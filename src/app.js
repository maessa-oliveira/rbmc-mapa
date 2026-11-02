// Interface do mapa (Leaflet). Cálculos em ./geo.js.
import { maisProximas, situacao, orientacao, lerCoordenada, dms } from './geo.js';

const L = window.L;
const $ = (id) => document.getElementById(id);
const CORES = { ativa: '#1f9d55', instavel: '#e3a008', parada: '#9aa5a3' };
const IBGE = 'https://geoftp.ibge.gov.br/informacoes_sobre_posicionamento_geodesico/rbmc/';
const fmt = (v, c = 1) => v.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const mapa = L.map('mapa', { zoomControl: false, preferCanvas: true }).setView([-14.5, -51], 4);
L.control.zoom({ position: 'topright' }).addTo(mapa);
L.control.scale({ imperial: false, position: 'bottomright' }).addTo(mapa);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(mapa);

const camada = L.layerGroup().addTo(mapa);
// Margem para o painel não cobrir o que foi enquadrado.
const margem = () => (innerWidth > 720
  ? { paddingTopLeft: [370, 40], paddingBottomRight: [50, 40] }
  : { paddingTopLeft: [30, 30], paddingBottomRight: [30, innerHeight * 0.52 + 20] });
const linhas = L.layerGroup().addTo(mapa);
let obra = null;
let dados = { estacoes: [], dias_consultados: [] };
const marcadores = new Map();

function popup(e) {
  const s = situacao(e, dados.dias_consultados.length || 7);
  return `<div class="pop"><h3>${esc(e.id)} — ${esc(e.cidade)}/${esc(e.uf)}</h3>
  <table>
    <tr><td>Situação</td><td><span class="bola ${s.chave}"></span>${esc(s.texto)}</td></tr>
    <tr><td>Latitude</td><td>${dms(e.lat, 'lat')}</td></tr>
    <tr><td>Longitude</td><td>${dms(e.lon, 'lon')}</td></tr>
    <tr><td>Alt. elipsoidal</td><td>${fmt(e.h, 2)} m</td></tr>
    <tr><td>Receptor</td><td>${esc(e.receptor || '—')}</td></tr>
    <tr><td>Constelações</td><td>${esc(e.sistemas || '—')}</td></tr>
    ${e.antena ? `<tr><td>Antena</td><td>${esc(e.antena)}</td></tr>` : ''}
  </table>
  <a href="${IBGE}relatorio/Descritivo_${encodeURIComponent(e.id)}.pdf" target="_blank" rel="noopener">Descritivo da estação (IBGE)</a></div>`;
}

function desenharEstacoes() {
  camada.clearLayers();
  marcadores.clear();
  const termo = $('filtro').value.trim().toLowerCase();
  const so = $('soAtivas').checked;
  const dias = dados.dias_consultados.length || 7;
  let n = 0;
  for (const e of dados.estacoes) {
    const s = situacao(e, dias);
    if (so && s.chave === 'parada') continue;
    const texto = `${e.id} ${e.cidade} ${e.uf} ${sigla(e.uf)}`.toLowerCase();
    if (termo && !texto.includes(termo)) continue;
    const m = L.circleMarker([e.lat, e.lon], {
      radius: 6, weight: 1.5, color: '#fff', fillColor: CORES[s.chave], fillOpacity: 0.95,
    }).bindPopup(popup(e)).bindTooltip(e.id, { direction: 'top', offset: [0, -6] });
    m.addTo(camada);
    marcadores.set(e.id, m);
    n++;
  }
  const ativas = dados.estacoes.filter((e) => situacao(e, dias).chave !== 'parada').length;
  $('resumo').textContent = `${n} no mapa · ${ativas} de ${dados.estacoes.length} com dados na última semana`;
  if (termo && n && n <= 30) mapa.fitBounds(L.featureGroup([...marcadores.values()]).getBounds(), { maxZoom: 9, ...margem() });
}

function marcarObra(lat, lon, centralizar = true) {
  $('erro').textContent = '';
  if (obra) obra.remove();
  obra = L.marker([lat, lon], { title: 'Obra' }).addTo(mapa).bindTooltip('Obra', { permanent: true, direction: 'right' });
  const dias = dados.dias_consultados.length || 7;
  const filtro = $('soAtivas').checked ? (e) => situacao(e, dias).chave !== 'parada' : () => true;
  const prox = maisProximas(dados.estacoes, lat, lon, 5, filtro);
  linhas.clearLayers();
  $('lista').innerHTML = '';
  prox.forEach((e, i) => {
    const s = situacao(e, dias);
    L.polyline([[lat, lon], [e.lat, e.lon]], { color: i ? '#5d6b68' : '#1f7a6d', weight: i ? 1 : 2.5, dashArray: i ? '4 6' : null }).addTo(linhas);
    const li = document.createElement('li');
    li.innerHTML = `<div class="topo"><span><span class="bola ${s.chave}"></span>${esc(e.id)} · ${esc(e.cidade)}/${esc(sigla(e.uf))}</span>
      <span class="km">${fmt(e.km)} km</span></div>
      <div class="det">azimute ${fmt(e.azimute, 0)}° · ${esc(s.texto)} · ${esc(e.sistemas || '')}</div>`;
    li.addEventListener('click', () => { mapa.setView([e.lat, e.lon], 11); marcadores.get(e.id)?.openPopup(); });
    $('lista').append(li);
  });
  $('resultado').hidden = !prox.length;
  if (prox.length) {
    const o = orientacao(prox[0].km);
    $('dica').className = `dica ${o.nivel}`;
    $('dica').textContent = `${o.texto} (Orientação geral — confira as especificações do seu receptor.)`;
    if (centralizar) mapa.fitBounds(L.latLngBounds([[lat, lon], ...prox.slice(0, 3).map((e) => [e.lat, e.lon])]), margem());
  }
  window.__rbmc = { obra: { lat, lon }, proximas: prox };
}

const UF = { acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE', 'distrito federal': 'DF',
  'espirito santo': 'ES', goias: 'GO', maranhao: 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG',
  para: 'PA', paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN',
  'rio grande do sul': 'RS', rondonia: 'RO', roraima: 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO' };
function sigla(uf) {
  const k = String(uf).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return UF[k] || uf;
}

$('busca').addEventListener('submit', (ev) => {
  ev.preventDefault();
  try {
    const { lat, lon } = lerCoordenada($('coord').value);
    marcarObra(lat, lon);
  } catch (err) { $('erro').textContent = err.message; }
});
$('btnGPS').addEventListener('click', () => {
  if (!navigator.geolocation) { $('erro').textContent = 'Seu navegador não informa localização.'; return; }
  navigator.geolocation.getCurrentPosition(
    (p) => { $('coord').value = `${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`; marcarObra(p.coords.latitude, p.coords.longitude); },
    () => { $('erro').textContent = 'Não foi possível obter a localização (permissão negada?).'; },
    { enableHighAccuracy: true, timeout: 15000 },
  );
});
mapa.on('click', (ev) => {
  $('coord').value = `${ev.latlng.lat.toFixed(6)}, ${ev.latlng.lng.toFixed(6)}`;
  marcarObra(ev.latlng.lat, ev.latlng.lng, false);
});
$('filtro').addEventListener('input', desenharEstacoes);
$('soAtivas').addEventListener('change', () => { desenharEstacoes(); if (obra) { const p = obra.getLatLng(); marcarObra(p.lat, p.lng, false); } });

async function iniciar() {
  try {
    const r = await fetch('data/rbmc.json', { cache: 'no-cache' });
    dados = await r.json();
  } catch {
    $('resumo').textContent = 'Não foi possível carregar os dados das estações.';
    return;
  }
  const quando = new Date(dados.atualizado_em);
  $('atualizado').textContent = `Dados atualizados em ${quando.toLocaleDateString('pt-BR')} ${quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`;
  if (dados.amostra) {
    const aviso = document.createElement('p');
    aviso.className = 'aviso';
    aviso.textContent = 'Exibindo amostra (Nordeste). A lista completa é gerada automaticamente pelo GitHub Actions.';
    $('resumo').after(aviso);
  }
  desenharEstacoes();
  const q = new URLSearchParams(location.search).get('obra');
  if (q) { $('coord').value = q; $('busca').requestSubmit(); }
  window.__pronto = true;
}
iniciar();
