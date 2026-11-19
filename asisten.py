"""
Asisten Belajar PHYNthagoras (backend).

Alur:  browser siswa  ->  /api/asisten (Flask, file ini)  ->  API DeepSeek
API Key DeepSeek HANYA disimpan di sini (dibaca dari file .env atau
Environment Variables di hosting), tidak pernah dikirim ke browser.

Aturan cara asisten membimbing siswa (Mathematical Literacy, RMT,
Cognitive Load) ada di file asisten_aturan.md supaya mudah diedit.
"""

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

from flask import Blueprint, jsonify, request

FOLDER = Path(__file__).parent
asisten = Blueprint("asisten", __name__)


# ---------------------------------------------------------------
# 1. Baca file .env (format: NAMA=nilai). Tanpa library tambahan.
#    Nilai yang sudah ada di Environment Variables hosting tidak ditimpa.
# ---------------------------------------------------------------
def baca_env():
    file_env = FOLDER / ".env"
    if not file_env.exists():
        return
    for baris in file_env.read_text(encoding="utf-8").splitlines():
        baris = baris.strip()
        if not baris or baris.startswith("#") or "=" not in baris:
            continue
        nama, nilai = baris.split("=", 1)
        os.environ.setdefault(nama.strip(), nilai.strip().strip('"').strip("'"))


baca_env()

ALAMAT_DEEPSEEK = "https://api.deepseek.com/chat/completions"
MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")

# Web yang boleh memanggil backend ini (CORS).
# Laptop selalu boleh; alamat web GitHub Pages ditulis di IZIN_ASAL pada .env
# (atau Environment Variables di hosting), dipisah koma.
IZIN_ASAL = ["http://127.0.0.1:5000", "http://localhost:5000"] + [
    a.strip().rstrip("/") for a in os.environ.get("IZIN_ASAL", "").split(",") if a.strip()]

# Batas supaya biaya API tetap kecil
MAKS_RIWAYAT = 12       # jumlah pesan terakhir yang dikirim ke AI
MAKS_HURUF = 800        # panjang maksimal satu pesan siswa
MAKS_TOKEN_JAWABAN = 400


# ---------------------------------------------------------------
# 2. Aturan untuk AI (system prompt) dari asisten_aturan.md
#    Komentar <!-- ... --> di file itu tidak ikut dikirim ke AI.
# ---------------------------------------------------------------
def aturan_asisten():
    teks = (FOLDER / "asisten_aturan.md").read_text(encoding="utf-8")
    while "<!--" in teks and "-->" in teks:
        awal = teks.index("<!--")
        akhir = teks.index("-->", awal) + 3
        teks = teks[:awal] + teks[akhir:]
    return teks.strip()


def konteks_halaman(konteks):
    """Informasi tambahan: siswa sedang di halaman apa / mengerjakan soal apa."""
    if not isinstance(konteks, dict):
        return ""
    bagian = []
    if konteks.get("halaman"):
        bagian.append(f"Siswa sedang membuka halaman: {str(konteks['halaman'])[:120]}.")
    if konteks.get("soal"):
        bagian.append("Siswa sedang mengerjakan soal latihan berikut (JANGAN beri jawaban akhirnya):\n"
                      + str(konteks["soal"])[:600])
    return "\n".join(bagian)


# ---------------------------------------------------------------
# 3. Rute /api/asisten
#    Masukan (JSON): { "pesan": [{"peran": "siswa"|"asisten", "teks": "..."}],
#                      "konteks": {"halaman": "...", "soal": "..."} }
#    Keluaran (JSON): { "balasan": "..." }  atau  { "galat": "..." }
# ---------------------------------------------------------------
@asisten.route("/api/asisten", methods=["POST", "OPTIONS"])
def tanya_asisten():
    if request.method == "OPTIONS":
        return "", 204

    kunci = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if not kunci:
        return jsonify(galat="Asisten belum aktif: API Key DeepSeek belum diisi di file .env."), 503

    data = request.get_json(silent=True) or {}
    riwayat = data.get("pesan")
    if not isinstance(riwayat, list) or not riwayat:
        return jsonify(galat="Pesan kosong."), 400

    pesan_ai = [{"role": "system", "content": aturan_asisten()}]
    tambahan = konteks_halaman(data.get("konteks"))
    if tambahan:
        pesan_ai.append({"role": "system", "content": tambahan})

    for p in riwayat[-MAKS_RIWAYAT:]:
        if not isinstance(p, dict):
            continue
        teks = str(p.get("teks", "")).strip()[:MAKS_HURUF]
        if teks:
            peran = "assistant" if p.get("peran") == "asisten" else "user"
            pesan_ai.append({"role": peran, "content": teks})

    if pesan_ai[-1]["role"] != "user":
        return jsonify(galat="Pesan terakhir harus dari siswa."), 400

    isi = json.dumps({
        "model": MODEL,
        "messages": pesan_ai,
        "temperature": 0.4,
        "max_tokens": MAKS_TOKEN_JAWABAN,
        "stream": False,
    }).encode("utf-8")
    permintaan = urllib.request.Request(ALAMAT_DEEPSEEK, data=isi, method="POST", headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {kunci}",
    })

    try:
        with urllib.request.urlopen(permintaan, timeout=60) as r:
            hasil = json.loads(r.read().decode("utf-8"))
        balasan = hasil["choices"][0]["message"]["content"].strip()
    except urllib.error.HTTPError as e:
        pesan = {401: "API Key DeepSeek salah atau tidak berlaku.",
                 402: "Saldo DeepSeek habis. Isi ulang saldo di platform.deepseek.com.",
                 429: "Terlalu banyak pertanyaan sekaligus. Tunggu sebentar, lalu coba lagi."}
        return jsonify(galat=pesan.get(e.code, f"DeepSeek sedang bermasalah (kode {e.code}).")), 502
    except Exception:
        return jsonify(galat="Tidak bisa terhubung ke DeepSeek. Coba lagi sebentar lagi."), 502

    return jsonify(balasan=balasan)


# CORS: izinkan web di GitHub Pages memanggil backend ini
@asisten.after_app_request
def izinkan_asal(respons):
    asal = request.headers.get("Origin", "").rstrip("/")
    if request.path.startswith("/api/") and asal in IZIN_ASAL:
        respons.headers["Access-Control-Allow-Origin"] = asal
        respons.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
        respons.headers["Access-Control-Allow-Headers"] = "Content-Type"
        respons.headers["Vary"] = "Origin"
    return respons
