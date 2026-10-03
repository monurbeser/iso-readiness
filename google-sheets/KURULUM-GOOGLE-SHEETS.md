# Leadleri Google Sheets'e yazma (ücretsiz, yaklaşık 10 dakika)

Her "Email me the report" talebinde:
- Google Sheet'teki **Leads** sayfasına yeni bir satır eklenir (34 sütun: kişi, şirket, skorlar, açıklar, önerilen modüller, kaynak/AM/partner, yanıtlar).
- Ziyaretçinin PDF raporu Google Drive'da **ISO 9001-2026 Readiness Reports** klasörüne kaydedilir ve linki satıra yazılır.
- Satış ekibi için boş **Status** (açılır liste: New, Contacted, Meeting booked, Proposal sent, Won, Lost, Not a fit), **Owner**, **Next step** ve **Notes** sütunları gelir. Yeni kayıtlar "New" durumunda başlar.
- Sıcak leadlerin Temperature hücresi renklenir.

## 1. Tabloyu oluşturun
1. Google Drive → Yeni → Google E-Tablolar. Adı: `ISO 9001-2026 Leads`.
2. Menü: **Uzantılar → Apps Script**.
3. Açılan editörde `Code.gs` içeriğini silip bu klasördeki `Code.gs` dosyasının tamamını yapıştırın. Kaydedin.

## 2. Bir kez kurulum çalıştırın
1. Üstteki fonksiyon listesinden **setup** seçip **Çalıştır**'a basın.
2. Google izin isteyecek (E-Tablo ve Drive erişimi). Kendi hesabınızla onaylayın. "Google bu uygulamayı doğrulamadı" uyarısı çıkarsa: Gelişmiş → (proje adı)'na git.
3. **Yürütme günlüğü**'nde `SECRET = ...` satırını görürsünüz. Bu gizli anahtarı kopyalayın. Sonradan da **Proje Ayarları → Komut dosyası özellikleri**'nden görebilirsiniz.
4. Tabloda Leads sayfası ve bordo başlık satırı oluşur, Drive'da rapor klasörü açılır.

## 3. Web uygulaması olarak yayınlayın
1. **Dağıt → Yeni dağıtım → tür: Web uygulaması**.
2. Şu kişi olarak yürüt: **Ben**. Erişimi olanlar: **Herkes**. Bu ayar sadece doğru gizli anahtarı bilen isteklerin yazmasına izin verir; tabloyu kimseyle paylaşmaz.
3. **Dağıt**'a basın ve verilen URL'yi kopyalayın (`https://script.google.com/macros/s/.../exec`).

## 4. Vercel / Netlify'a ekleyin
Ortam değişkeni ekleyin:
```
SHEETS_WEBHOOK_URL = https://script.google.com/macros/s/XXXX/exec?key=GIZLI_ANAHTAR
```
Yeniden deploy edin. Sitede bir test raporu gönderin; birkaç saniye içinde tabloda satır ve Drive'da PDF görünür.

## Notlar
- Tabloyu satış ekibiyle Google'ın normal paylaşımıyla paylaşın. Sütunları yeniden sıralayabilir ya da yeni sütun ekleyebilirsiniz; script verileri başlık adına göre yazar.
- `Code.gs`'i değiştirirseniz **Dağıt → Dağıtımları yönet → Düzenle → Yeni sürüm** ile yeniden yayınlayın; URL aynı kalır.
- PDF'lerin başka bir klasöre gitmesini isterseniz o klasörün ID'sini Komut dosyası özelliklerinde `FOLDER_ID` olarak girin.
- Kişisel veriler (GDPR/PDPL) bu tabloda tutulduğu için paylaşımı sadece ilgili ekiple sınırlayın.
