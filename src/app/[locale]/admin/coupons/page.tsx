import { getAdminCoupons } from "@/lib/admin";
import { CouponsManager } from "@/components/admin/coupons-manager";

export const dynamic = "force-dynamic";

export default async function AdminCouponsPage() {
  const coupons = await getAdminCoupons();

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 32 }}>İndirim Kuponları</h1>
          <p className="muted">Promosyon kodları ve indirim kuponlarını yönetin ({coupons.length} adet)</p>
        </div>
      </div>

      <section className="panel">
        <CouponsManager initialCoupons={coupons} />
      </section>
    </div>
  );
}
