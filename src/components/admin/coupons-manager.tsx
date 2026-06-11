"use client";

import { useState } from "react";
import { Plus, Trash2, Edit2, Check, X } from "lucide-react";
import type { Coupon } from "@/lib/admin";

export function CouponsManager({ initialCoupons }: { initialCoupons: Coupon[] }) {
  const [coupons, setCoupons] = useState<Coupon[]>(initialCoupons);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  
  const [formData, setFormData] = useState<Partial<Coupon>>({});

  const handleEdit = (coupon: Coupon) => {
    setEditingId(coupon.id);
    setFormData({ ...coupon, expires_at: coupon.expires_at ? coupon.expires_at.slice(0, 16) : "" });
  };

  const handleCancel = () => {
    setEditingId(null);
    setFormData({});
  };

  const handleSave = async (id: string) => {
    setLoading(id);
    setMessage("");

    const action = id === "new" ? "create" : "update";
    
    // Process form data
    const payload = { ...formData };
    if (!payload.expires_at) payload.expires_at = null;
    if (payload.expires_at && typeof payload.expires_at === "string" && payload.expires_at.length === 16) {
      payload.expires_at = new Date(payload.expires_at).toISOString();
    }
    if (payload.max_uses === 0 || (payload.max_uses as any) === "") payload.max_uses = null;

    const body = {
      action,
      ...payload,
      ...(id !== "new" && { id, updates: payload }),
    };

    const res = await fetch("/api/admin/coupons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      if (action === "create") {
        setCoupons([data.coupon, ...coupons]);
      } else {
        setCoupons(coupons.map(c => c.id === id ? { ...c, ...payload } : c));
      }
      setEditingId(null);
      setMessage(`✅ Kupon başarıyla ${action === "create" ? "oluşturuldu" : "güncellendi"}.`);
    } else {
      const err = await res.json();
      setMessage(`❌ Hata: ${err.error || "Bilinmeyen hata"}`);
    }
    setLoading(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Bu kuponu silmek istediğinize emin misiniz?")) return;
    
    setLoading(id);
    setMessage("");

    const res = await fetch("/api/admin/coupons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });

    if (res.ok) {
      setCoupons(coupons.filter(c => c.id !== id));
      setMessage("✅ Kupon silindi.");
    } else {
      setMessage("❌ Hata oluştu.");
    }
    setLoading(null);
  };

  const addNew = () => {
    setEditingId("new");
    setFormData({
      code: "",
      discount_type: "percentage",
      discount_value: 10,
      max_uses: null,
      expires_at: "",
      is_active: true,
    });
  };

  return (
    <div>
      {message && <div className="notice" style={{ marginBottom: 16 }}>{message}</div>}
      
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button className="button primary" onClick={addNew} disabled={editingId !== null}>
          <Plus size={16} /> Yeni Kupon Ekle
        </button>
      </div>

      <div className="table-list">
        {editingId === "new" && (
          <div className="table-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 12, background: "var(--bg-subtle)" }}>
             <h3 style={{ margin: 0 }}>Yeni Kupon Oluştur</h3>
             <CouponForm formData={formData} setFormData={setFormData} />
             <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
               <button className="button ghost" onClick={handleCancel} disabled={loading === "new"}><X size={16} /> İptal</button>
               <button className="button primary" onClick={() => handleSave("new")} disabled={loading === "new"}><Check size={16} /> Kaydet</button>
             </div>
          </div>
        )}

        {coupons.length === 0 && editingId !== "new" && (
          <div className="table-row" style={{ justifyContent: "center", color: "var(--text-muted)" }}>
            Henüz kupon oluşturulmamış.
          </div>
        )}

        {coupons.map(coupon => (
          editingId === coupon.id ? (
            <div key={coupon.id} className="table-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 12, background: "var(--bg-subtle)" }}>
               <h3 style={{ margin: 0 }}>Kupon Düzenle: {coupon.code}</h3>
               <CouponForm formData={formData} setFormData={setFormData} />
               <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                 <button className="button ghost" onClick={handleCancel} disabled={loading === coupon.id}><X size={16} /> İptal</button>
                 <button className="button primary" onClick={() => handleSave(coupon.id)} disabled={loading === coupon.id}><Check size={16} /> Kaydet</button>
               </div>
            </div>
          ) : (
            <div key={coupon.id} className="table-row" style={{ gap: 16 }}>
              <div style={{ flex: 1 }}>
                <strong style={{ fontSize: 18, fontFamily: "monospace" }}>{coupon.code}</strong>
                <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                  Kullanım: {coupon.used_count} / {coupon.max_uses || "Sınırsız"}
                </div>
              </div>
              <div style={{ width: 120, textAlign: "right" }}>
                <strong style={{ fontSize: 18 }}>
                  {coupon.discount_type === "percentage" ? `%${coupon.discount_value}` : `${(coupon.discount_value / 100).toLocaleString("tr-TR")} TL`}
                </strong>
                <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>İndirim</div>
              </div>
              <div style={{ width: 140 }}>
                {coupon.expires_at ? (
                  <div style={{ fontSize: 13, color: new Date(coupon.expires_at) < new Date() ? "var(--error)" : "inherit" }}>
                    SKT: {new Date(coupon.expires_at).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}
                  </div>
                ) : (
                  <div className="muted" style={{ fontSize: 13 }}>Süresiz</div>
                )}
              </div>
              <div style={{ width: 80, textAlign: "center" }}>
                <span className="tag" style={{ background: coupon.is_active ? "var(--success)" : "var(--error)", color: "#fff" }}>
                  {coupon.is_active ? "Aktif" : "Pasif"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="button ghost icon-only" onClick={() => handleEdit(coupon)} disabled={loading !== null} aria-label="Düzenle">
                  <Edit2 size={16} />
                </button>
                <button className="button ghost icon-only" onClick={() => handleDelete(coupon.id)} disabled={loading !== null} style={{ color: "var(--error)" }} aria-label="Sil">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          )
        ))}
      </div>
    </div>
  );
}

function CouponForm({ formData, setFormData }: { formData: Partial<Coupon>, setFormData: (data: Partial<Coupon>) => void }) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    let finalValue: any = value;
    
    if (type === "number") finalValue = value === "" ? "" : Number(value);
    if (type === "checkbox") finalValue = (e.target as HTMLInputElement).checked;

    setFormData({ ...formData, [name]: finalValue });
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <div className="field">
        <label>Kupon Kodu</label>
        <input name="code" value={formData.code || ""} onChange={handleChange} placeholder="Örn: YAZ2026" style={{ textTransform: "uppercase" }} />
      </div>
      <div className="field" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label>İndirim Tipi</label>
          <select name="discount_type" value={formData.discount_type || "percentage"} onChange={handleChange}>
            <option value="percentage">Yüzde (%)</option>
            <option value="fixed">Sabit (Kuruş)</option>
          </select>
        </div>
        <div>
          <label>Değer</label>
          <input 
            name="discount_value" 
            type="number" 
            value={formData.discount_value || ""} 
            onChange={handleChange} 
            placeholder={formData.discount_type === "percentage" ? "Örn: 20" : "Örn: 5000 (50 TL)"} 
          />
        </div>
      </div>
      <div className="field" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label>Maksimum Kullanım</label>
          <input name="max_uses" type="number" value={formData.max_uses || ""} onChange={handleChange} placeholder="Boş = Sınırsız" />
        </div>
        <div>
          <label>Son Kullanma Tarihi</label>
          <input name="expires_at" type="datetime-local" value={formData.expires_at || ""} onChange={handleChange} />
        </div>
      </div>
      <div className="field" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input name="is_active" type="checkbox" checked={formData.is_active !== false} onChange={handleChange} style={{ width: "auto" }} />
        <label style={{ margin: 0 }}>Aktif (Kullanılabilir)</label>
      </div>
    </div>
  );
}
