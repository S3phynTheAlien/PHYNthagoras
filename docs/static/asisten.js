/* =========================================================
   Asisten Belajar PHYNthagoras (kotak chat)
   - Tombol "🤖 Asisten" di pojok kanan bawah membuka kotak chat
   - Pesan dikirim ke backend Flask (/api/asisten), BUKAN langsung ke
     DeepSeek, supaya API Key tetap rahasia
   - Saat siswa mengerjakan soal latihan, teks soalnya ikut dikirim
     sebagai konteks (dari window.PhynKonteksSoal, diisi latihan.js)
   - Saat Ujian Akhir, asisten tidak bisa dipakai
   ========================================================= */
(function () {
    const KUNCI_SIMPAN = "phyn-asisten-riwayat";
    const SAPAAN = "Halo! Aku **Asisten PHYN** 👋 Ceritakan soal yang sedang kamu kerjakan. " +
        "Aku tidak akan langsung memberi jawabannya, tapi kita cari bersama langkah demi langkah, ya!";
    const SARAN = ["Aku bingung mulai dari mana", "Sisi mana yang miring?", "Tolong cek jawabanku"];

    // --- alamat backend ---
    function alamatApi() {
        const alamat = ((window.PHYN_ASISTEN || {}).alamat || "").trim().replace(/\/+$/, "");
        if (alamat) return alamat + "/api/asisten";
        // dijalankan di laptop dengan python app.py → backend ada di alamat yang sama
        if (["localhost", "127.0.0.1"].includes(location.hostname)) return "api/asisten";
        return null;
    }

    // --- riwayat chat (hanya untuk tab ini) ---
    let riwayat = [];
    try { riwayat = JSON.parse(sessionStorage.getItem(KUNCI_SIMPAN)) || []; } catch (e) { riwayat = []; }
    const simpan = () => { try { sessionStorage.setItem(KUNCI_SIMPAN, JSON.stringify(riwayat.slice(-30))); } catch (e) { /* abaikan */ } };

    // --- tampilan ---
    const tombol = document.createElement("button");
    tombol.type = "button";
    tombol.className = "tombol-asisten";
    tombol.setAttribute("aria-label", "Buka Asisten Belajar");
    tombol.innerHTML = "🤖 <span>Asisten</span>";

    const panel = document.createElement("section");
    panel.className = "asisten";
    panel.hidden = true;
    panel.setAttribute("aria-label", "Asisten Belajar");
    panel.innerHTML = `
        <header class="asisten-kepala">
            <div>
                <strong>🤖 Asisten PHYN</strong>
                <span>Membimbing langkah demi langkah</span>
            </div>
            <button type="button" class="asisten-ikon" id="asisten-baru" title="Mulai percakapan baru">↺</button>
            <button type="button" class="asisten-ikon asisten-tutup" id="asisten-tutup" aria-label="Tutup asisten">Tutup ✕</button>
        </header>
        <div class="asisten-isi" id="asisten-isi" aria-live="polite"></div>
        <div class="asisten-saran" id="asisten-saran"></div>
        <form class="asisten-form" id="asisten-form">
            <textarea id="asisten-masukan" rows="1" maxlength="800" placeholder="Tulis pertanyaanmu…" aria-label="Pertanyaan"></textarea>
            <button type="submit" id="asisten-kirim" aria-label="Kirim">➤</button>
        </form>`;

    document.body.append(tombol, panel);
    const isi = panel.querySelector("#asisten-isi");
    const saran = panel.querySelector("#asisten-saran");
    const form = panel.querySelector("#asisten-form");
    const masukan = panel.querySelector("#asisten-masukan");
    const kirim = panel.querySelector("#asisten-kirim");
    let sedangMenunggu = false;

    // teks aman: **tebal** dan baris baru saja
    function rapikan(teks) {
        const aman = teks.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return aman.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");
    }

    function gelembung(peran, teks, kelas = "") {
        const div = document.createElement("div");
        div.className = `asisten-pesan dari-${peran} ${kelas}`.trim();
        div.innerHTML = rapikan(teks);
        isi.appendChild(div);
        isi.scrollTop = isi.scrollHeight;
        return div;
    }

    function gambarUlang() {
        isi.innerHTML = "";
        gelembung("asisten", SAPAAN);
        riwayat.forEach((p) => gelembung(p.peran, p.teks));
        saran.innerHTML = riwayat.length ? "" :
            SARAN.map((s) => `<button type="button">${s}</button>`).join("");
    }

    function sedangUjian() {
        return (window.PhynKonteksSoal || {}).mode === "ujian";
    }

    function konteks() {
        const k = { halaman: document.title.replace(/ — PHYNthagoras$/, "") };
        const soal = window.PhynKonteksSoal;
        if (soal && soal.teks) k.soal = soal.teks;
        return k;
    }

    async function tanya(teks) {
        teks = teks.trim();
        if (!teks || sedangMenunggu) return;

        if (sedangUjian()) {
            gelembung("asisten", "Asisten sedang istirahat selama **Ujian Akhir** ✋ Kerjakan dengan kemampuanmu sendiri, ya. Semangat!", "info");
            return;
        }

        riwayat.push({ peran: "siswa", teks });
        simpan();
        gelembung("siswa", teks);
        saran.innerHTML = "";
        masukan.value = "";
        masukan.style.height = "";

        const api = alamatApi();
        if (!api) {
            gelembung("asisten", "Asisten belum disambungkan ke server. Untuk sementara, coba baca **Materi** atau buka **Petunjuk** di soal latihan, ya.", "galat");
            return;
        }

        sedangMenunggu = true;
        kirim.disabled = true;
        const tunggu = gelembung("asisten", "Asisten sedang berpikir…", "menunggu");

        try {
            const r = await fetch(api, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pesan: riwayat, konteks: konteks() }),
            });
            const data = await r.json().catch(() => ({}));
            tunggu.remove();
            if (r.ok && data.balasan) {
                riwayat.push({ peran: "asisten", teks: data.balasan });
                simpan();
                gelembung("asisten", data.balasan);
            } else {
                gelembung("asisten", data.galat || "Maaf, asisten sedang bermasalah. Coba lagi sebentar lagi.", "galat");
            }
        } catch (e) {
            tunggu.remove();
            gelembung("asisten", "Tidak bisa terhubung ke asisten. Periksa koneksi internetmu, lalu coba lagi.", "galat");
        } finally {
            sedangMenunggu = false;
            kirim.disabled = false;
            masukan.focus();
        }
    }

    function buka() {
        panel.hidden = false;
        tombol.hidden = true;
        gambarUlang();
        masukan.focus();
    }

    function tutup() {
        panel.hidden = true;
        tombol.hidden = false;
        tombol.focus();
    }

    tombol.addEventListener("click", buka);
    panel.querySelector("#asisten-tutup").addEventListener("click", tutup);
    panel.querySelector("#asisten-baru").addEventListener("click", () => {
        riwayat = [];
        simpan();
        gambarUlang();
        masukan.focus();
    });
    saran.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (b) tanya(b.textContent);
    });
    form.addEventListener("submit", (e) => {
        e.preventDefault();
        tanya(masukan.value);
    });
    masukan.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            tanya(masukan.value);
        }
    });
    masukan.addEventListener("input", () => {
        masukan.style.height = "";
        masukan.style.height = Math.min(masukan.scrollHeight, 120) + "px";
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !panel.hidden) tutup();
    });
})();
