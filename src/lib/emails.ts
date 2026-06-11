const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.NEXT_PUBLIC_FROM_EMAIL || "SupaOps <noreply@supaops.com>";

export async function sendJobCompletionEmail(to: string, jobTitle: string, status: "success" | "error", errorMsg?: string) {
  if (!RESEND_API_KEY) {
    console.warn("RESEND_API_KEY is not set. Email not sent.");
    return;
  }

  const isSuccess = status === "success";
  const subject = isSuccess 
    ? `✅ Görev Tamamlandı: ${jobTitle}` 
    : `❌ Görev Başarısız: ${jobTitle}`;

  const htmlBody = `
    <div style="font-family: sans-serif; padding: 20px; line-height: 1.5; color: #333;">
      <h2 style="color: ${isSuccess ? '#2e7d32' : '#d32f2f'}">
        ${isSuccess ? 'Taşıma Başarıyla Tamamlandı' : 'Taşıma Sırasında Hata Oluştu'}
      </h2>
      <p>Merhaba,</p>
      <p>Başlatmış olduğunuz <strong>"${jobTitle}"</strong> isimli taşıma görevi sonuçlandı.</p>
      
      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 6px; margin: 20px 0;">
        <strong>Durum:</strong> ${isSuccess ? 'Başarılı' : 'Hatalı'}<br/>
        ${!isSuccess && errorMsg ? `<strong>Hata Detayı:</strong> <span style="color: #d32f2f">${errorMsg}</span>` : ''}
      </div>

      <p>Detayları görmek için <a href="${process.env.NEXT_PUBLIC_SITE_URL}/app/jobs">kontrol panelinize</a> giriş yapabilirsiniz.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
      <p style="font-size: 12px; color: #999;">Bu otomatik bir bilgilendirme mesajıdır. Lütfen yanıtlamayınız.</p>
    </div>
  `;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to,
        subject,
        html: htmlBody,
      }),
    });

    if (!res.ok) {
      const errData = await res.json();
      console.error("Resend API Error:", errData);
    }
  } catch (error) {
    console.error("Failed to send email:", error);
  }
}
