import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kullanıcı Sözleşmesi | SupaOps",
};

export default function TermsPage() {
  return (
    <article className="legal-doc" style={{ lineHeight: 1.6 }}>
      <h1 style={{ marginBottom: 24, fontSize: 32 }}>Kullanıcı Sözleşmesi (Şartlar ve Koşullar)</h1>
      <p className="muted" style={{ marginBottom: 32 }}>Son güncelleme: {new Date().toLocaleDateString('tr-TR')}</p>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ marginBottom: 16 }}>1. Hizmetin Tanımı</h2>
        <p style={{ marginBottom: 16 }}>SupaOps, Supabase projelerinizin yönetimini, yapılandırmasını ve sunucular arası taşınmasını otomatize eden bir yazılım (SaaS) platformudur. Sisteme giriş yaptığınızda ve hizmetlerimizi kullandığınızda bu sözleşmenin şartlarını kabul etmiş sayılırsınız.</p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ marginBottom: 16 }}>2. Kullanıcı Sorumlulukları</h2>
        <p style={{ marginBottom: 16 }}>Platform üzerinden gerçekleştirdiğiniz sunucu komutları, veritabanı kopyalamaları ve kurulum işlemlerinin nihai sonuçlarından kullanıcı sorumludur. SupaOps, işlemleri gerçekleştirmeden önce mutlaka veritabanı yedeği (backup) almanızı önermektedir.</p>
        <p>Hizmeti, yasa dışı amaçlar için veya üçüncü şahıslara ait sunuculara izinsiz müdahale etmek için kullanmak kesinlikle yasaktır.</p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ marginBottom: 16 }}>3. İadeler ve İptaller</h2>
        <p>SupaOps ön ödemeli kredi/paket modeliyle (Kullandıkça Öde) çalışır. Satın alınan paketlerdeki krediler kullanıldıkça bakiyeden düşer. Satın alımdan itibaren 14 gün içerisinde hiç kullanılmamış bakiyeler için iade talep edilebilir. Kısmen veya tamamen kullanılmış krediler için iade yapılmaz.</p>
      </section>

      <section>
        <h2 style={{ marginBottom: 16 }}>4. Sorumluluk Sınırı</h2>
        <p>SupaOps üzerinden çalıştırılan otomatik işlemler sonucunda meydana gelebilecek veri kayıplarından, sunucu kesintilerinden veya donanımsal zararlardan platformumuz veya geliştiricilerimiz sorumlu tutulamaz. Yazılım &quot;olduğu gibi&quot; (as-is) sunulmaktadır.</p>
      </section>
    </article>
  );
}
