import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gizlilik Politikası | SupaOps",
};

export default function PrivacyPage() {
  return (
    <article className="legal-doc" style={{ lineHeight: 1.6 }}>
      <h1 style={{ marginBottom: 24, fontSize: 32 }}>Gizlilik Politikası</h1>
      <p className="muted" style={{ marginBottom: 32 }}>Son güncelleme: {new Date().toLocaleDateString('tr-TR')}</p>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ marginBottom: 16 }}>1. Toplanan Veriler</h2>
        <p style={{ marginBottom: 16 }}>SupaOps olarak, hizmetlerimizi sunabilmek amacıyla hesap bilgileriniz (e-posta adresi), fatura bilgileriniz (ödeme altyapısı aracılığıyla işlenir) ve uygulama kullanım loglarınız toplanmaktadır.</p>
        <p>Sunucu taşıma ve kurulum işlemleriniz sırasında girdiğiniz şifre veya &quot;secret&quot; anahtarları **veri tabanımızda asla saklanmaz**; işlem tamamlandığında veya hata aldığında bellekten temizlenir.</p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ marginBottom: 16 }}>2. Verilerin Kullanımı</h2>
        <p>Topladığımız veriler yalnızca size hizmet sağlamak, teknik destek sunmak, faturalandırma yapmak ve yasal yükümlülüklerimizi yerine getirmek amacıyla kullanılmaktadır. Üçüncü şahıs veya kurumlarla verileriniz ticari amaçlarla paylaşılmaz.</p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ marginBottom: 16 }}>3. Ödeme Altyapısı</h2>
        <p>Ödeme işlemlerimiz lisanslı ve güvenli ödeme kuruluşu olan PayTR üzerinden gerçekleştirilmektedir. Kredi kartı verileriniz doğrudan PayTR sistemlerine iletilir, bizim sunucularımızdan geçmez veya sunucularımızda saklanmaz.</p>
      </section>

      <section>
        <h2 style={{ marginBottom: 16 }}>4. İletişim</h2>
        <p>Gizlilik süreçlerimiz hakkında sorularınız için bizimle <a href="mailto:support@supaops.com" style={{ color: "var(--primary)" }}>support@supaops.com</a> adresi üzerinden iletişime geçebilirsiniz.</p>
      </section>
    </article>
  );
}
