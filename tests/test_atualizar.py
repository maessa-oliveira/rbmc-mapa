"""Testes do atualizador com respostas simuladas do servidor do IBGE (sem internet)."""

import datetime as dt
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import atualizar_rbmc as A  # noqa: E402

LOG_BAIR = """     BAIR00BRA Site Information Form (site log v2.0)

1.   Site Identification of the GNSS Monument

     Site Name                : IRECE
     Nine Character ID        : BAIR00BRA

2.   Site Location Information

     City or Town             : IRECE
     State or Province        : BAHIA
     Country or Region        : BRA
     Approximate Position (SIRGAS2000)
       X coordinate (m)       :  4659351.65
       Latitude (N is +)      : -111820.33
       Longitude (E is +)     : -0415130.66
       Elevation (m,ellips.)  :  723.92 m

3.   GNSS Receiver Information

3.1  Receiver Type            : TRIMBLE NETRS
     Satellite System         : GPS
     Date Removed             : 2014-03-24T21:30Z

3.2  Receiver Type            : TRIMBLE ALLOY
     Satellite System         : GPS+GLO+GAL+BDS
     Date Removed             : (CCYY-MM-DDThh:mmZ)

3.x  Receiver Type            : (A20, from rcvr_ant.tab; see instr.)

4.   GNSS Antenna Information

4.1  Antenna Type             : TRM55971.00     NONE
     Date Removed             : 2020-05-05T00:00Z

4.2  Antenna Type             : TRM59800.00     SCIS
     Date Removed             : (CCYY-MM-DDThh:mmZ)
"""

LISTA_LOGS = """<html><body><a href="?C=N;O=D">Name</a><a href="/informacoes/">Parent</a>
<a href="bair00bra_20141024.log">x</a><a href="bair00bra_20200713.log">x</a>
<a href="ssa100bra_20190101.log">x</a><a href="leiame.txt">x</a></body></html>"""


def falso_servidor(url: str) -> str:
    if url.endswith("log_sirgas/"):
        return LISTA_LOGS
    if url.endswith("bair00bra_20200713.log"):
        return LOG_BAIR
    if url.endswith("ssa100bra_20190101.log"):
        return LOG_BAIR.replace("IRECE", "SALVADOR").replace("-0415130.66", "-0383035.00")
    if "/dados/" in url:
        if url.endswith("/304/"):
            raise RuntimeError("dia ainda não publicado")
        return '<a href="bair3031.zip">a</a><a href="xxxx3031.zip">b</a>'
    raise AssertionError(f"URL inesperada: {url}")


@pytest.mark.parametrize(
    "txt,esperado",
    [("-111820.33", -11.30564722), ("-0415130.66", -41.85851667), ("+023000.00", 2.5), ("-0090000", -9.0)],
)
def test_dms_compacto(txt, esperado):
    assert A.dms_compacto(txt) == pytest.approx(esperado, abs=1e-8)


def test_dms_invalido():
    with pytest.raises(ValueError):
        A.dms_compacto("-117020.00")


def test_logs_mais_recentes_escolhe_a_ultima_versao():
    nomes = A.listar("x/log_sirgas/", falso_servidor)
    assert A.logs_mais_recentes(nomes) == {"BAIR": "bair00bra_20200713.log", "SSA1": "ssa100bra_20190101.log"}


def test_ler_site_log_pega_receptor_e_antena_atuais():
    e = A.ler_site_log(LOG_BAIR)
    assert e["nome"] == "Irece" and e["uf"] == "Bahia" and e["pais"] == "BRA"
    assert e["receptor"] == "TRIMBLE ALLOY"
    assert e["sistemas"] == "GPS+GLO+GAL+BDS"
    assert e["antena"] == "TRM59800.00 SCIS"
    assert e["h"] == pytest.approx(723.92)


def test_gerar_completo():
    d = A.gerar(hoje=dt.date(2026, 11, 1), buscar=falso_servidor, dias=3)
    ids = {e["id"]: e for e in d["estacoes"]}
    assert set(ids) == {"BAIR", "SSA1"}
    assert ids["BAIR"]["dias_com_dados"] == 2  # 1 dos 3 dias falhou
    assert ids["SSA1"]["dias_com_dados"] == 0
    assert ids["SSA1"]["lon"] == pytest.approx(-38.50972222)
    assert d["sem_site_log"] == ["XXXX"]
    assert d["dias_consultados"] == ["2026-10-30", "2026-10-29"]


def test_altitude_ausente_vira_none():
    e = A.ler_site_log(LOG_BAIR.replace("723.92 m", "(m)"))
    assert e["h"] is None


def test_dados_publicados_sao_json_valido_para_o_navegador():
    """O navegador rejeita NaN/Infinity: o arquivo publicado precisa ser JSON estrito."""
    import json

    def recusa(c):
        raise ValueError(f"valor inválido no JSON: {c}")

    caminho = Path(__file__).resolve().parents[1] / "data" / "rbmc.json"
    d = json.loads(caminho.read_text(encoding="utf-8"), parse_constant=recusa)
    assert len(d["estacoes"]) >= 10
    assert all(-90 <= e["lat"] <= 90 and -180 <= e["lon"] <= 180 for e in d["estacoes"])
