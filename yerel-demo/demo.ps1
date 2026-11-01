#Requires -Version 5.1
<#
  GoverHub yerel demo — Windows yönetim betiği (Docker Desktop ile).
  Doğrudan değil, bu klasördeki .cmd dosyalarıyla çalıştırılır:
    baslat.cmd        Demoyu başlatır (kayıtlar korunur) ve tarayıcıyı açar
    durdur.cmd        Demoyu durdurur (kayıtlar korunur)
    durum.cmd         Ne çalıştığını gösterir
    tunel-ac.cmd      Telefon testi için geçici HTTPS tüneli açar (davet bağlantısıyla)
    tunel-kapat.cmd   Tüneli kapatır
    SIFIRLA-tum-demo-verisi.cmd   Bütün demo kayıtlarını SİLER (onay ister)
  Yalnızca demo verisi içindir; üretim için değildir.
#>
param([Parameter(Position = 0)][string]$Komut = 'baslat')

# Windows PowerShell 5.1'de, docker'ın hata akışına yazdığı ilerleme satırları "Stop" ile betiği durdurur.
# Bu yüzden hatalar çıkış koduyla denetlenir.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$Klasor = $PSScriptRoot
$Compose = @('compose', '--project-directory', $Klasor, '-f', (Join-Path $Klasor 'compose.yaml'))
$Adres = 'http://localhost:8080'
$SaglikAdresi = 'http://127.0.0.1:8080/api/health'

function Yaz([string]$Metin, [string]$Renk = 'Gray') { Write-Host $Metin -ForegroundColor $Renk }
function Baslik([string]$Metin) { Write-Host ''; Write-Host "== $Metin ==" -ForegroundColor Cyan }
function Dur([string]$Metin) { Write-Host ''; Write-Host $Metin -ForegroundColor Red; exit 1 }

function Dc {
  & docker @Compose @args
  if ($LASTEXITCODE -ne 0) { Dur "Docker komutu başarısız oldu: docker compose $($args -join ' ') (kod $LASTEXITCODE)" }
}

function Docker-Hazir {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Yaz 'Docker Desktop bu bilgisayarda kurulu görünmüyor.' Red
    Yaz 'Kurmak için (bir kez):'
    Yaz '  1) PowerShell''i açın ve şunu yazın:  winget install -e --id Docker.DockerDesktop'
    Yaz '     (ya da https://www.docker.com/products/docker-desktop/ adresinden indirin)'
    Yaz '  2) Kurulum bitince bilgisayarı yeniden başlatın ve Docker Desktop''ı bir kez açıp koşulları kabul edin.'
    Yaz '  3) Sonra baslat.cmd dosyasını tekrar çalıştırın.'
    exit 1
  }
  & docker info *> $null
  if ($LASTEXITCODE -ne 0) {
    $exe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (Test-Path $exe) {
      Yaz 'Docker Desktop açılıyor; hazır olması 1-3 dakika sürebilir...' Yellow
      Start-Process -FilePath $exe | Out-Null
    } else {
      Yaz 'Docker Desktop çalışmıyor. Başlat menüsünden "Docker Desktop" uygulamasını açın.' Yellow
    }
    $son = (Get-Date).AddMinutes(4)
    do {
      Start-Sleep -Seconds 5
      & docker info *> $null
    } while ($LASTEXITCODE -ne 0 -and (Get-Date) -lt $son)
    if ($LASTEXITCODE -ne 0) { Dur 'Docker Desktop 4 dakikada hazır olmadı. Docker Desktop penceresindeki uyarıyı kontrol edip tekrar deneyin.' }
  }
  $tur = (& docker info --format '{{.OSType}}' 2>$null | Out-String).Trim()
  if ($tur -ne 'linux') {
    Dur 'Docker Desktop "Windows containers" kipinde. Görev çubuğundaki Docker simgesine sağ tıklayıp "Switch to Linux containers..." seçin, sonra tekrar deneyin.'
  }
}

function Uygulama-Calisiyor {
  try { return ((Invoke-WebRequest -UseBasicParsing -Uri $SaglikAdresi -TimeoutSec 3).StatusCode -eq 200) } catch { return $false }
}

function Uygulamayi-Bekle([int]$Dakika = 15) {
  $son = (Get-Date).AddMinutes($Dakika)
  while ((Get-Date) -lt $son) {
    if (Uygulama-Calisiyor) { return }
    Start-Sleep -Seconds 3
  }
  Yaz 'Uygulama zamanında yanıt vermedi. Son kayıtlar:' Red
  & docker @Compose logs --tail 40 app
  Dur 'Sorunu bildirmek için yukarıdaki satırları kopyalayabilirsiniz.'
}

function Giris-Bilgisi {
  Yaz ''
  Yaz 'Demo girişi:' Green
  Yaz '  1) E-posta: sahip@demo.goverhub.test   ->  "Kod gönder"'
  Yaz '  2) "Demo kutusundan kodu getir"  ->  "Giriş yap"'
  Yaz '  Diğer demo hesapları: mudur@, personel@, uzman@ (hizmet sağlayıcı), danisman@ ... @demo.goverhub.test'
  Yaz '  E-posta gönderilmez; gerçek bir e-posta adresi kabul edilmez.'
}

function Baslat([bool]$TarayiciAc = $true) {
  Docker-Hazir
  Baslik 'GoverHub yerel demo başlatılıyor'
  Yaz 'İlk seferde imajlar hazırlanır (internet gerekir, 5-15 dakika). Sonraki açılışlar kısa sürer.'
  Yaz 'Kayıtlar korunur; bu işlem hiçbir kaydı silmez.'
  Dc up -d --build --remove-orphans
  Yaz 'Uygulamanın hazır olması bekleniyor...'
  Uygulamayi-Bekle
  Baslik 'Hazır'
  Yaz "Adres: $Adres" Green
  Giris-Bilgisi
  Yaz ''
  Yaz 'Durdurmak için: durdur.cmd   ·   Telefon testi için: tunel-ac.cmd'
  if ($TarayiciAc) {
    try { Start-Process $Adres -ErrorAction Stop | Out-Null } catch { Yaz "Tarayıcı açılamadı; tarayıcıda $Adres adresini açın." Yellow }
  }
}

function Durdur {
  Docker-Hazir
  Baslik 'GoverHub yerel demo durduruluyor'
  Dc --profile tunel down
  Yaz 'Durduruldu. Kayıtlar korunuyor; tekrar açmak için baslat.cmd.' Green
}

function Sifirla {
  Docker-Hazir
  Baslik 'DİKKAT: Bütün demo kayıtları silinecek'
  Yaz 'Silinecekler: veritabanındaki tüm kayıtlar (görevler, ölçümler, uygunsuzluklar, hizmet işleri, ekip),' Yellow
  Yaz 'yüklenen fotoğraflar ve tünel davet anahtarı. Bu işlem geri alınamaz.' Yellow
  $cevap = Read-Host 'Onaylamak için büyük harflerle SIFIRLA yazın (vazgeçmek için Enter)'
  if ($cevap -cne 'SIFIRLA') { Yaz 'Vazgeçildi. Hiçbir şey silinmedi.' Green; return }
  Dc --profile tunel down -v --remove-orphans
  Yaz 'Bütün demo kayıtları silindi. baslat.cmd ile temiz demo verisiyle yeniden açabilirsiniz.' Green
}

function Tunel-Adresi {
  $kayit = (& docker @Compose --profile tunel logs tunnel 2>&1 | Out-String)
  $m = [regex]::Matches($kayit, 'https://[a-z0-9-]+\.trycloudflare\.com')
  if ($m.Count -gt 0) { return $m[$m.Count - 1].Value }
  return $null
}

function Tunel-Ac {
  Docker-Hazir
  if (-not (Uygulama-Calisiyor)) { Baslat $false }
  Baslik 'Telefon testi için geçici HTTPS tüneli'
  Yaz 'Tünel yalnızca erişim kapısına bağlanır; veritabanı ve API doğrudan açılmaz.'
  Dc --profile tunel up -d kapi
  # Her açılışta yeni davet anahtarı: eski bağlantılar çalışmaz olur.
  Dc --profile tunel exec -T kapi /etc/goverhub/ayarla.sh --yeni
  Dc --profile tunel up -d --force-recreate tunnel
  Yaz 'Tünel adresi bekleniyor (en çok 1 dakika)...'
  $url = $null
  for ($i = 0; $i -lt 30 -and -not $url; $i++) { Start-Sleep -Seconds 2; $url = Tunel-Adresi }
  if (-not $url) {
    & docker @Compose --profile tunel logs --tail 30 tunnel
    Dur 'Tünel adresi alınamadı. İnternet bağlantısını kontrol edin; şirket ağı veya güvenlik yazılımı engelliyor olabilir.'
  }
  $anahtar = (& docker @Compose --profile tunel exec -T kapi cat /data/goverhub/erisim-anahtari | Out-String).Trim()
  $davet = "$url/erisim/$anahtar"
  Baslik 'Tünel açık'
  Yaz 'Telefonda açılacak davet bağlantısı (yalnızca test edecek kişiyle paylaşın):' Green
  Yaz "  $davet" White
  try { Set-Clipboard -Value $davet; Yaz '  (Bağlantı panoya kopyalandı.)' } catch { }
  Yaz ''
  Yaz 'Bilinmesi gerekenler:' Yellow
  Yaz '  - Tünel yalnızca bu bilgisayar açıkken ve Docker Desktop çalışırken çalışır.'
  Yaz '    Bilgisayar uyku moduna geçerse veya kapanırsa telefondan erişim kesilir.'
  Yaz '  - Adres ve davet anahtarı her tunel-ac.cmd çalıştırmasında değişir.'
  Yaz '  - Davet bağlantısı olmadan adres "403" sayfası gösterir.'
  Yaz '  - Bu ücretsiz, hesapsız geçici tünel yalnızca deneme içindir; çalışma süresi garanti edilmez.'
  Yaz '  - İş bitince: tunel-kapat.cmd'
  Giris-Bilgisi
}

function Tunel-Kapat {
  Docker-Hazir
  Baslik 'Tünel kapatılıyor'
  Dc --profile tunel stop tunnel kapi
  Dc --profile tunel rm -f tunnel kapi
  Yaz 'Tünel kapatıldı. Bilgisayardaki demo çalışmaya devam ediyor.' Green
}

function Durum {
  Docker-Hazir
  Baslik 'Durum'
  & docker @Compose --profile tunel ps --format 'table {{.Service}}\t{{.Status}}'
  if (Uygulama-Calisiyor) { Yaz "Uygulama: çalışıyor -> $Adres" Green } else { Yaz 'Uygulama: çalışmıyor (baslat.cmd)' Yellow }
  $url = $null
  $calisan = (& docker @Compose --profile tunel ps --status running --services 2>$null | Out-String)
  if ($calisan -match '(?m)^tunnel\s*$') { $url = Tunel-Adresi }
  if ($url) { Yaz "Tünel: açık -> $url (davet bağlantısı tunel-ac.cmd çıktısında)" Green } else { Yaz 'Tünel: kapalı' }
}

switch ($Komut) {
  'baslat'      { Baslat }
  'durdur'      { Durdur }
  'sifirla'     { Sifirla }
  'tunel-ac'    { Tunel-Ac }
  'tunel-kapat' { Tunel-Kapat }
  'durum'       { Durum }
  default       { Dur "Bilinmeyen komut: $Komut" }
}
