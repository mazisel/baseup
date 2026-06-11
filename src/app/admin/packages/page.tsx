import { getAdminPackages } from "@/lib/admin";
import { PackagesManager } from "@/components/admin/packages-manager";

export const dynamic = "force-dynamic";

export default async function AdminPackagesPage() {
  const packages = await getAdminPackages();

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 32 }}>Paketler ve Planlar</h1>
          <p className="muted">Kullanıcıların satın alabileceği paketleri yönetin ({packages.length} adet)</p>
        </div>
      </div>

      <section className="panel">
        <PackagesManager initialPackages={packages} />
      </section>
    </div>
  );
}
