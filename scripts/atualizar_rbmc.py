#!/usr/bin/env python3
"""Atualiza data/rbmc.json a partir dos dados públicos do IBGE.

Fontes (geoftp.ibge.gov.br, públicas):
  - rbmc/relatorio/log_sirgas/  -> site logs (formato IGS) com coordenadas SIRGAS 2000,
                                    receptor e antena de cada estação
  - rbmc/dados/<ano>/<dia>/      -> arquivos diários de observação; usamos a presença do
                                    arquivo nos últimos 7 dias para indicar se a estação
                                    está transmitindo dados

Roda diariamente no GitHub Actions. Só usa a biblioteca padrão do Python.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

BASE = "https://geoftp.ibge.gov.br/informacoes_sobre_posicionamento_geodesico/rbmc/"
RE_LOG = re.compile(r"^([a-z0-9]{4})00[a-z]{3}_(\d{8})\.log$", re.I)


class _Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hrefs: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.hrefs.append(href)


def baixar(url: str, tentativas: int = 3) -> str:
    erro = None
    for _ in range(tentativas):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return r.read().decode("latin-1")
        except Exception as e:  # noqa: BLE001 - registra e tenta de novo
            erro = e
    raise RuntimeError(f"Falha ao baixar {url}: {erro}")


def listar(url: str, buscar=baixar) -> list[str]:
    p = _Links()
    p.feed(buscar(url))
    return [h for h in p.hrefs if not h.startswith(("?", "/", "http"))]


def logs_mais_recentes(nomes: list[str]) -> dict[str, str]:
    """{'BAIR': 'bair00bra_20200713.log', ...} — o log mais recente de cada estação."""
    ult: dict[str, tuple[str, str]] = {}
    for n in nomes:
        m = RE_LOG.match(n)
        if not m:
            continue
        sid, data = m.group(1).upper(), m.group(2)
        if sid not in ult or data > ult[sid][0]:
            ult[sid] = (data, n)
    return {k: v[1] for k, v in sorted(ult.items())}


def dms_compacto(txt: str) -> float:
    """Converte o formato do site log (+/-DDMMSS.SS ou +/-DDDMMSS.SS) em graus decimais."""
    t = txt.strip()
    neg = t.startswith("-")
    t = t.lstrip("+-")
    inteiro, _, frac = t.partition(".")
    inteiro = inteiro.zfill(6)
    g, m, s = int(inteiro[:-4]), int(inteiro[-4:-2]), float(f"{inteiro[-2:]}.{frac or 0}")
    if m >= 60 or s >= 60:
        raise ValueError(f"DMS inválido: {txt!r}")
    v = g + m / 60 + s / 3600
    return round(-v if neg else v, 8)


def _campo(texto: str, rotulo: str) -> str:
    m = re.search(rf"{re.escape(rotulo)}\s*:\s*(.*)", texto)
    return m.group(1).strip() if m else ""


def _ultimo_bloco(texto: str, secao: str, rotulo: str) -> dict[str, str]:
    """Último bloco numerado (ex.: 3.x Receiver Type) do site log."""
    blocos = re.split(rf"\n(?={secao}\.\d+\s+{re.escape(rotulo)})", texto)
    validos = [b for b in blocos if re.match(rf"{secao}\.\d+\s+{re.escape(rotulo)}", b)]
    if not validos:
        return {}
    b = validos[-1].split("\n\n")[0]
    campos = {}
    for linha in b.splitlines():
        if ":" in linha:
            k, v = linha.split(":", 1)
            campos[re.sub(r"^\d+\.\d+\s+", "", k).strip()] = v.strip()
    return campos


def ler_site_log(texto: str) -> dict:
    rec = _ultimo_bloco(texto, "3", "Receiver Type")
    ant = _ultimo_bloco(texto, "4", "Antenna Type")
    return {
        "nome": _campo(texto, "Site Name").title(),
        "cidade": _campo(texto, "City or Town").title(),
        "uf": _campo(texto, "State or Province").title(),
        "pais": _campo(texto, "Country or Region"),
        "lat": dms_compacto(_campo(texto, "Latitude (N is +)")),
        "lon": dms_compacto(_campo(texto, "Longitude (E is +)")),
        "h": float(re.sub(r"[^\d.\-]", "", _campo(texto, "Elevation (m,ellips.)")) or "nan"),
        "receptor": rec.get("Receiver Type", ""),
        "sistemas": rec.get("Satellite System", ""),
        "antena": re.sub(r"\s+", " ", ant.get("Antenna Type", "")),
    }


def atividade(hoje: dt.date, dias: int, buscar=baixar) -> tuple[dict[str, int], list[str]]:
    """Conta em quantos dos últimos `dias` cada estação tem arquivo de dados."""
    cont: dict[str, int] = {}
    consultados = []
    for k in range(1, dias + 1):
        d = hoje - dt.timedelta(days=k)
        url = f"{BASE}dados/{d.year}/{d.timetuple().tm_yday:03d}/"
        try:
            arquivos = listar(url, buscar)
        except RuntimeError:
            continue
        consultados.append(d.isoformat())
        for a in arquivos:
            if a.lower().endswith(".zip"):
                sid = a[:4].upper()
                cont[sid] = cont.get(sid, 0) + 1
    return cont, consultados


def gerar(hoje: dt.date | None = None, buscar=baixar, dias: int = 7) -> dict:
    hoje = hoje or dt.date.today()
    logs = logs_mais_recentes(listar(BASE + "relatorio/log_sirgas/", buscar))
    if not logs:
        raise RuntimeError("Nenhum site log encontrado — estrutura do IBGE mudou?")
    cont, consultados = atividade(hoje, dias, buscar)
    estacoes, falhas = [], []
    for sid, arq in logs.items():
        try:
            e = ler_site_log(buscar(BASE + "relatorio/log_sirgas/" + arq))
        except (RuntimeError, ValueError) as exc:
            falhas.append(f"{sid}: {exc}")
            continue
        e.update(id=sid, log=arq, dias_com_dados=cont.get(sid, 0))
        estacoes.append(e)
    return {
        "atualizado_em": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "fonte": "IBGE — Rede Brasileira de Monitoramento Contínuo dos Sistemas GNSS (RBMC)",
        "dias_consultados": consultados,
        "estacoes": estacoes,
        "sem_site_log": sorted(set(cont) - set(logs)),
        "falhas": falhas,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--saida", default=str(Path(__file__).resolve().parents[1] / "data" / "rbmc.json"))
    ap.add_argument("--dias", type=int, default=7)
    a = ap.parse_args(argv)
    dados = gerar(dias=a.dias)
    ativas = sum(1 for e in dados["estacoes"] if e["dias_com_dados"])
    if len(dados["estacoes"]) < 50:
        print("Menos de 50 estações — abortando para não publicar dado quebrado.", file=sys.stderr)
        return 1
    Path(a.saida).parent.mkdir(parents=True, exist_ok=True)
    Path(a.saida).write_text(json.dumps(dados, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(dados['estacoes'])} estações ({ativas} com dados nos últimos {a.dias} dias) -> {a.saida}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
