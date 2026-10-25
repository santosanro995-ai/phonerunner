# Android Virtual UI

Dashboard untuk satu container Android virtual. Buka `https://icodecloud.biz.id` untuk melihat kartu Galaxy S10, lalu klik kartu atau tombol **Buka perangkat** untuk membuka workspace Android. Workspace menyediakan tampilan noVNC tanpa toolbar bawaan, status perangkat, tombol hubungkan ulang, dan mode layar penuh.

Dashboard ini tidak membuat Android kedua: layar Android berasal dari container `android-vps` yang sudah berjalan. Interaksi sentuh dan keyboard dikirimkan ke emulator melalui noVNC/WebSocket. Kemampuan Android tetap bergantung pada image dan konfigurasi emulator yang terpasang.

## 1. Pastikan container Android aktif

Di VPS, cek container dan pastikan noVNC hanya dipublikasikan ke localhost:

```bash
cd /opt/android-vps
docker compose ps
docker inspect --format '{{.State.Status}}' android-vps
```

Container yang dipakai aplikasi ini bernama `android-vps`, dan port noVNC harus dapat diakses lokal di `127.0.0.1:6080`. Jangan membuka port 6080 langsung ke internet. Pastikan image Android memang menyediakan noVNC di port 6080 dan WebSocket `websockify`.

## 2. Push aplikasi ke GitHub dan clone di VPS

Simpan proyek ini di repository GitHub agar bisa diambil VPS menggunakan `git clone`. Buat repository baru di GitHub tanpa README, license, atau `.gitignore` bawaan agar push pertama tidak bentrok.

Di PowerShell komputer lokal, dari folder proyek:

```powershell
cd C:\Users\AXIOO\Desktop\phonerunner
git init
git add index.html device.html app.css server.js package.json README.md
git commit -m "Add Android virtual dashboard"
git branch -M main
git remote add origin https://github.com/USERNAME/REPOSITORY.git
git push -u origin main
```

Ganti `USERNAME/REPOSITORY` dengan akun dan nama repository GitHub Anda. Jika folder proyek ini sudah menjadi Git repository, jangan jalankan `git init`; cukup `git add`, `git commit`, lalu atur remote jika belum ada (`git remote add origin ...`) dan push. Saat diminta, autentikasi ke GitHub menggunakan metode yang sudah dikonfigurasi di komputer Anda.

Di VPS, pasang Git dan clone repository. Ganti URL di bawah dengan URL repository milik Anda:

```bash
sudo apt-get update
sudo apt-get install -y git
sudo install -d -m 0755 /opt/android-ui
sudo git clone https://github.com/USERNAME/REPOSITORY.git /opt/android-ui
```

Untuk repository privat, konfigurasikan akses GitHub dari VPS dengan deploy key atau metode autentikasi Git yang aman. Jangan menyimpan token akses di URL remote atau menempelkannya di shell history.

Backend membutuhkan Node.js 18 atau yang lebih baru. Periksa:

```bash
node --version
```

Jika belum terpasang atau versinya di bawah 18, instal Node.js 20 LTS dari repository Node.js resmi yang sesuai distro VPS. Kemudian verifikasi aplikasi:

```bash
cd /opt/android-ui
node --check server.js
```

Tes backend secara sementara:

```bash
node server.js
```

Biarkan perintah berjalan, lalu dari sesi SSH kedua tes:

```bash
curl -i http://127.0.0.1:3000/
curl -i http://127.0.0.1:3000/device
curl -i http://127.0.0.1:3000/app.css
curl -i http://127.0.0.1:3000/api/status
```

Hentikan tes sementara dengan `Ctrl+C` sebelum melanjutkan.

Setelah mengirim perubahan baru ke GitHub, perbarui aplikasi di VPS:

```bash
sudo git -C /opt/android-ui pull --ff-only
sudo systemctl restart android-ui
sudo systemctl status android-ui --no-pager
```

## 3. Jalankan backend otomatis dengan systemd

Buat unit service:

```bash
sudo nano /etc/systemd/system/android-ui.service
```

Isi:

```ini
[Unit]
Description=Android Virtual dashboard backend
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=/opt/android-ui
ExecStart=/usr/bin/node /opt/android-ui/server.js
Restart=always
RestartSec=3
User=root
Environment=HOST=127.0.0.1
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

Simpan lalu aktifkan:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now android-ui
sudo systemctl status android-ui --no-pager
```

Log backend jika ada error:

```bash
sudo journalctl -u android-ui -n 100 --no-pager
```

Service memakai root agar dapat membaca status Docker melalui socket lokal. Backend hanya menerima permintaan GET/HEAD, menyediakan berkas UI, dan menjalankan `docker inspect` untuk status; port 3000 tetap terikat ke localhost, bukan ke internet.

## 4. Atur reverse proxy Nginx

Backup konfigurasi Nginx saat ini sebelum diedit:

```bash
sudo cp /etc/nginx/sites-available/android-vps /etc/nginx/sites-available/android-vps.bak
sudo nano /etc/nginx/sites-available/android-vps
```

Di **server block HTTPS** untuk `icodecloud.biz.id`, ganti route lama yang meneruskan `/` langsung ke port 6080 dengan tiga lokasi berikut. Jika konfigurasi SSL sudah dipasang Certbot, pertahankan baris `listen 443 ssl`, `ssl_certificate`, dan `ssl_certificate_key` yang sudah ada.

```nginx
location / {
    auth_basic "Android";
    auth_basic_user_file /etc/nginx/.android_htpasswd;
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location /api/ {
    auth_basic "Android";
    auth_basic_user_file /etc/nginx/.android_htpasswd;
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
}

location ^~ /novnc/ {
    auth_basic "Android";
    auth_basic_user_file /etc/nginx/.android_htpasswd;
    proxy_pass http://127.0.0.1:6080/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 86400;
}
```

Garis miring di akhir `proxy_pass` noVNC membuang prefix `/novnc/` sebelum request diteruskan ke container. WebSocket menggunakan `/novnc/websockify`. Proteksi Basic Auth harus tetap aktif di ketiga lokasi. Jangan buat lokasi noVNC tanpa autentikasi.

Periksa dan muat ulang Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Pastikan sertifikat TLS masih valid dan domain tetap mengarah ke IP VPS. Untuk firewall provider/UFW, izinkan TCP 80 dan 443; jangan izinkan publik ke port 3000 atau 6080.

## 5. Buka dan gunakan perangkat

1. Buka `https://icodecloud.biz.id` dan masuk dengan username/password Basic Auth yang sudah dibuat sebelumnya.
2. Dashboard menampilkan kartu **Galaxy S10** dan status container. Klik kartu atau **Buka perangkat**.
3. Tunggu koneksi noVNC. Klik layar Android untuk mengontrol; sentuhan/klik dan input keyboard diteruskan ke emulator.
4. Gunakan **Layar penuh** agar workspace memenuhi layar. **Hubungkan ulang** memuat ulang koneksi web ke emulator.
5. Kembali ke dashboard dengan tombol panah atau tautan **Kembali ke dashboard**.

Menutup browser tidak menghentikan container Android. Container Docker dengan kebijakan `restart: always` tetap berjalan dan dimulai kembali saat daemon Docker/VPS restart. Jika halaman tidak tersambung, cek `docker compose ps`, `sudo systemctl status android-ui`, `sudo journalctl -u android-ui -n 100 --no-pager`, dan `/var/log/nginx/error.log`.
