const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || process.env.NEXT_PUBLIC_FROM_EMAIL || "Baseup <noreply@baseup.dev>";
const CONSUMER_EMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com", "hotmail.com", "outlook.com", "icloud.com", "yahoo.com"]);

export async function sendJobCompletionEmail(to: string, jobTitle: string, status: "success" | "error", errorMsg?: string) {
  if (!RESEND_API_KEY) {
    console.warn("RESEND_API_KEY is not set. Email not sent.");
    return;
  }
  if (usesConsumerEmailDomain(FROM_EMAIL)) {
    console.warn("RESEND_FROM_EMAIL must use a verified custom domain. Email not sent.");
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

export async function sendMonitorAlertEmail(to: string, monitorName: string, url: string, status: "down" | "up", errorMsg?: string | null) {
  if (!RESEND_API_KEY) {
    console.warn("RESEND_API_KEY is not set. Email not sent.");
    return;
  }
  if (usesConsumerEmailDomain(FROM_EMAIL)) {
    console.warn("RESEND_FROM_EMAIL must use a verified custom domain. Email not sent.");
    return;
  }

  const isDown = status === "down";
  const subject = isDown
    ? `🔴 Servis Erişilemiyor: ${monitorName}`
    : `🟢 Servis Düzeldi: ${monitorName}`;

  const htmlBody = `
    <div style="font-family: sans-serif; padding: 20px; line-height: 1.5; color: #333;">
      <h2 style="color: ${isDown ? '#d32f2f' : '#2e7d32'}">
        ${isDown ? 'Monitör DOWN durumuna geçti' : 'Monitör tekrar UP durumuna geçti'}
      </h2>
      <p>Merhaba,</p>
      <p><strong>${monitorName}</strong> monitörünüzün durumu değişti.</p>

      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 6px; margin: 20px 0;">
        <strong>URL:</strong> ${url}<br/>
        <strong>Durum:</strong> ${isDown ? 'DOWN (erişilemiyor)' : 'UP (erişilebilir)'}<br/>
        ${isDown && errorMsg ? `<strong>Hata:</strong> <span style="color: #d32f2f">${errorMsg}</span>` : ''}
      </div>

      <p>Detayları görmek için <a href="${process.env.NEXT_PUBLIC_SITE_URL}/app/monitors">kontrol panelinize</a> giriş yapabilirsiniz.</p>
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
      const errData = await res.json().catch(() => ({}));
      console.error("Resend API Error (monitor alert):", errData);
    }
  } catch (error) {
    console.error("Failed to send monitor alert email:", error);
  }
}

function usesConsumerEmailDomain(from: string) {
  const match = from.match(/@([^>\s]+)>?$/);
  return match ? CONSUMER_EMAIL_DOMAINS.has(match[1].toLowerCase()) : false;
}
