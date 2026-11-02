// Cálculos geodésicos usados pelo mapa (sem dependências; testados com `node --test`).

const A = 6378137.0;            // GRS 80 (SIRGAS 2000)
const F = 1 / 298.257222101;
const B = A * (1 - F);
const rad = (g) => (g * Math.PI) / 180;
const grau = (r) => (r * 180) / Math.PI;

/**
 * Problema inverso de Vincenty: distância (m) e azimute (graus, a partir do Norte)
 * do ponto 1 para o ponto 2 sobre o elipsoide GRS 80. Precisão sub-milimétrica.
 */
export function inverso(lat1, lon1, lat2, lon2) {
  if (lat1 === lat2 && lon1 === lon2) return { distancia: 0, azimute: 0 };
  const L = rad(lon2 - lon1);
  const U1 = Math.atan((1 - F) * Math.tan(rad(lat1)));
  const U2 = Math.atan((1 - F) * Math.tan(rad(lat2)));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
  let lam = L, iter = 0, sinS, cosS, sig, cos2a, cos2sm, sinLam, cosLam;
  do {
    sinLam = Math.sin(lam); cosLam = Math.cos(lam);
    sinS = Math.hypot(cU2 * sinLam, cU1 * sU2 - sU1 * cU2 * cosLam);
    cosS = sU1 * sU2 + cU1 * cU2 * cosLam;
    sig = Math.atan2(sinS, cosS);
    const sinA = (cU1 * cU2 * sinLam) / sinS;
    cos2a = 1 - sinA * sinA;
    cos2sm = cos2a ? cosS - (2 * sU1 * sU2) / cos2a : 0;
    const C = (F / 16) * cos2a * (4 + F * (4 - 3 * cos2a));
    const ant = lam;
    lam = L + (1 - C) * F * sinA * (sig + C * sinS * (cos2sm + C * cosS * (-1 + 2 * cos2sm * cos2sm)));
    if (Math.abs(lam - ant) < 1e-12) break;
  } while (++iter < 200);
  const u2 = (cos2a * (A * A - B * B)) / (B * B);
  const AA = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const BB = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const dSig = BB * sinS * (cos2sm + (BB / 4) * (cosS * (-1 + 2 * cos2sm * cos2sm) -
    (BB / 6) * cos2sm * (-3 + 4 * sinS * sinS) * (-3 + 4 * cos2sm * cos2sm)));
  const distancia = B * AA * (sig - dSig);
  const az = Math.atan2(cU2 * sinLam, cU1 * sU2 - sU1 * cU2 * cosLam);
  return { distancia, azimute: (grau(az) + 360) % 360 };
}

/** Estações ordenadas pela distância ao ponto, com distância (km) e azimute. */
export function maisProximas(estacoes, lat, lon, n = 5, filtro = () => true) {
  return estacoes
    .filter(filtro)
    .map((e) => {
      const { distancia, azimute } = inverso(lat, lon, e.lat, e.lon);
      return { ...e, km: distancia / 1000, azimute };
    })
    .sort((a, b) => a.km - b.km)
    .slice(0, n);
}

/** Situação da estação a partir dos dias com dados publicados na última semana. */
export function situacao(e, diasConsultados = 7) {
  const d = e.dias_com_dados ?? 0;
  if (d === 0) return { chave: 'parada', texto: 'sem dados recentes' };
  if (d >= Math.max(1, diasConsultados - 1)) return { chave: 'ativa', texto: 'ativa' };
  return { chave: 'instavel', texto: `instável (${d} de ${diasConsultados} dias)` };
}

/**
 * Orientação prática pela distância até a base. É uma regra de bolso — a precisão real depende
 * do receptor, das frequências, da ionosfera e do tempo de rastreio.
 */
export function orientacao(km) {
  if (km <= 20) return { nivel: 'bom', texto: 'Linha curta: RTK/NTRIP costuma fixar rápido e com precisão centimétrica.' };
  if (km <= 50) return { nivel: 'atencao', texto: 'Linha média: RTK pode demorar a fixar; use receptor multifrequência e confira em ponto conhecido. Estático pós-processado é mais seguro.' };
  return { nivel: 'longe', texto: 'Linha longa: prefira estático pós-processado (rastreio mais longo) ou PPP/RTX.' };
}

/** Lê "lat lon" em decimal (ponto ou vírgula) ou em graus/min/seg. */
export function lerCoordenada(texto) {
  const t = texto.trim();
  const dec = t.match(/^\s*(-?\d+(?:[.,]\d+)?)\s*[;,\s]\s*(-?\d+(?:[.,]\d+)?)\s*$/);
  if (dec && !/[°'"]/.test(t)) {
    const lat = Number(dec[1].replace(',', '.')), lon = Number(dec[2].replace(',', '.'));
    return validar(lat, lon);
  }
  const partes = t.match(/(\d+)\s*[°º]\s*(\d+)?\s*['′]?\s*(\d+(?:[.,]\d+)?)?\s*["″]?\s*([NSEWOL])/gi);
  if (partes && partes.length === 2) {
    const [lat, lon] = partes.map((p) => {
      const m = p.match(/(\d+)\s*[°º]\s*(\d+)?\s*['′]?\s*(\d+(?:[.,]\d+)?)?\s*["″]?\s*([NSEWOL])/i);
      const v = +m[1] + (+(m[2] || 0)) / 60 + Number((m[3] || '0').replace(',', '.')) / 3600;
      return /[SWO]/i.test(m[4]) ? -v : v;
    });
    return validar(lat, lon);
  }
  throw new Error('Formato não reconhecido. Use, por exemplo: -12.9714, -38.5014');
}

function validar(lat, lon) {
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) throw new Error('Coordenada fora do intervalo.');
  return { lat, lon };
}

export function dms(v, eixo) {
  const h = eixo === 'lat' ? (v < 0 ? 'S' : 'N') : (v < 0 ? 'W' : 'E');
  const s = Math.abs(v) * 3600;
  const g = Math.floor(s / 3600), m = Math.floor((s - g * 3600) / 60), se = s - g * 3600 - m * 60;
  return `${g}°${String(m).padStart(2, '0')}'${se.toFixed(2).padStart(5, '0').replace('.', ',')}"${h}`;
}
