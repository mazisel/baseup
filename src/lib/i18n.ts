import type { JobStatus } from "@/types/domain";
import type { Locale } from "@/lib/preference-shared";

export const COPY = {
  tr: {
    brand: "Baseup",
    nav: {
      login: "Giriş",
      openPanel: "Paneli aç",
      dashboard: "Kontrol paneli",
      newJob: "Yeni hizmet",
      settings: "Plan ve ayarlar",
      logout: "Çıkış"
    },
    preferences: {
      language: "Dil",
      theme: "Tema",
      light: "Açık",
      dark: "Koyu",
      turkish: "TR",
      english: "EN"
    },
    home: {
      eyebrow: "Supabase geçiş otomasyonu",
      headline: "Supabase taşıma operasyonlarını sıfır riskle dakikalara indirin.",
      lead: "Şifreler kaydedilmez, loglar maskelenir. Güvenli, izlenebilir ve kesintisiz göç platformu.",
      primary: "Ücretsiz dene",
      secondary: "Araçları gör",
      terminalTitle: "migration_9e2 · otomatik akış",
      terminalLines: [
        ["ok", "Proje analizi tamamlandı"],
        ["plain", "Migration workflow oluşturuldu"],
        ["warn", "Secret değerleri otomatik maskelendi"],
        ["plain", "Aktarım adımları sıraya alındı"],
        ["plain", "Müşteri raporu hazırlanıyor"],
        ["ok", "Canlı durum paylaşımı güncellendi"],
        ["plain", "Doğrulama skorları üretildi"],
        ["ok", "Teslimata hazır"]
      ],
      benefits: [
        "Sıfır veri tutma",
        "Uçtan uca şifreleme",
        "Canlı log takibi",
        "Kesintisiz taşıma"
      ],
      closing: {
        title: "Taşımaya hazır mısınız?",
        lead: "Sıfır riskle hemen deneyin. Kurulum gerektirmez.",
        cta: "Ücretsiz dene"
      },
      packagesTitle: "İhtiyacınıza uygun aracı seçin"
    },
    auth: {
      modeLabel: "Hesap işlemi",
      registerTab: "Kayıt ol",
      loginTab: "Giriş yap",
      registerTitle: "Hesap oluştur",
      registerDescription: "Adınızı ve e-posta adresinizi girin, güvenli kayıt bağlantısını gönderelim.",
      loginTitle: "Panele giriş",
      loginDescription: "E-posta adresinizi girin, güvenli giriş bağlantısını hemen gönderelim.",
      name: "Ad soyad",
      email: "E-posta",
      registerSubmit: "Kayıt bağlantısı gönder",
      loginSubmit: "Giriş bağlantısı gönder",
      loading: "Giriş yapılıyor",
      error: "Giriş başlatılamadı.",
      registerSuccessTitle: "Kayıt bağlantısı gönderildi",
      registerSuccessDescription: "Kayıt işlemini tamamlamak için e-postanızı kontrol edin:",
      loginSuccessTitle: "Giriş bağlantısı gönderildi",
      loginSuccessDescription: "Panele girmek için e-postanızı kontrol edin:"
    },
    dashboard: {
      title: "Kontrol paneli",
      description: "Taşıma, kurulum ve doğrulama hizmetlerinin güncel durumu.",
      newJob: "Yeni hizmet",
      monthUsage: "Bu ay kullanılan",
      running: "Çalışan",
      completed: "Tamamlanan",
      failed: "Hatalı",
      servicesTitle: "Hizmet paketleri",
      servicesDescription: "Müşteriye sunulacak işleri standart ve tekrar edilebilir paketlere ayırın.",
      recentJobs: "Son teslimatlar",
      recentDescription: "Canlı ilerleme ve teslim detaylarına buradan ulaşılır.",
      emptyTitle: "Henüz teslimat yok",
      emptyDescription: "İlk hizmeti başlattığınızda durum, kullanım ve log detayları burada görünür.",
      startJob: "Hizmet başlat",
      sanitizedJob: "Güvenli teslimat kaydı"
    },
    newJob: {
      title: "Yeni hizmet",
      description: "Hizmet paketini seçin, geçici erişim bilgilerini girin ve ilerlemeyi canlı izleyin."
    },
    launcher: {
      moduleTitle: "Hizmet paketi",
      moduleDescription: "Müşteriye sunacağınız işi seçin.",
      credits: "kredi",
      secretNotice: "Root şifresi, service key ve veritabanı bağlantısı kalıcı kayda alınmaz; loglarda maskelenir.",
      sourceHost: "Kaynak sunucu",
      sourcePass: "Kaynak root şifresi",
      targetHost: "Hedef sunucu",
      targetPass: "Hedef root şifresi",
      targetInstance: "Supabase instance",
      cloudDbUrl: "Supabase Cloud veritabanı URL'si",
      cloudApiUrl: "Cloud API adresi",
      cloudServiceKey: "Cloud service role key",
      studioDomain: "Studio domain",
      apiDomain: "API domain",
      siteUrl: "Site adresi",
      certbotEmail: "SSL e-postası",
      schemaFilter: "Şema filtresi",
      settingsUpdates: "Ayar değişiklikleri",
      settingsPlaceholder: "SITE_URL=https://app.example.com\nDISABLE_SIGNUP=false",
      getSSL: "SSL al",
      setupBackup: "Yedekleri taşı",
      migrateStorage: "Storage taşı",
      continueOnMinorErrors: "Küçük hatalarda devam et",
      skipInstall: "Kurulumu atla",
      submit: "Hizmeti başlat",
      loading: "Hazırlanıyor",
      createError: "Hizmet oluşturulamadı."
    },
    job: {
      back: "Kontrol paneli",
      id: "Teslimat ID",
      retry: "Tekrar çalıştır",
      retrying: "Hazırlanıyor",
      credits: "kredi",
      liveLog: "Canlı ilerleme",
      waitingLog: "Log bekleniyor...",
      summary: {
        runner: "Çalışma modu",
        source: "Kaynak",
        target: "Hedef",
        instance: "Instance",
        scope: "Kapsam"
      }
    },
    settings: {
      title: "Plan ve ayarlar",
      description: "Çalışma alanı, kullanım limitleri ve güvenlik politikası.",
      plan: "Plan",
      monthlyLimit: "Aylık hizmet limiti",
      parallelLimit: "Paralel hizmet",
      usage: "Kullanım",
      billingTitle: "Ödeme altyapısı",
      billingDescription: "Plan ve yetkilendirme modeli hazır. Ödeme sağlayıcısı ayrı bir bağlantı olarak eklenecek.",
      billingTag: "Bağlantı bekliyor",
      dbTitle: "Supabase veritabanı",
      dbDescription: "schema.sql; çalışma alanı, üyelik, plan, teslimat ve log tablolarını içerir.",
      dbTag: "Şema hazır",
      credentialTitle: "Gizli bilgi politikası",
      credentialDescription: "Root şifreleri ve service key değerleri kaydedilmez. Tekrar çalıştırma için erişim bilgileri yeniden istenir.",
      credentialTag: "Gizli bilgi korumalı"
    },
    status: {
      queued: "Sırada",
      running: "Çalışıyor",
      success: "Tamamlandı",
      error: "Hata",
      cancelled: "İptal"
    } satisfies Record<JobStatus, string>,
    misc: {
      demoWorkspace: "Demo çalışma alanı",
      owner: "sahip",
      report: "Rapor",
      file: "Dosya"
    }
  },
  en: {
    brand: "Baseup",
    nav: {
      login: "Sign in",
      openPanel: "Open dashboard",
      dashboard: "Dashboard",
      newJob: "New service",
      settings: "Plan and settings",
      logout: "Sign out"
    },
    preferences: {
      language: "Language",
      theme: "Theme",
      light: "Light",
      dark: "Dark",
      turkish: "TR",
      english: "EN"
    },
    home: {
      eyebrow: "Supabase migration automation",
      headline: "The Zero-Retention Supabase Migration Platform.",
      lead: "Move Supabase instances in minutes. No credentials stored, logs are masked. Secure and seamless.",
      primary: "Start free trial",
      secondary: "View tools",
      terminalTitle: "migration_9e2 · automated flow",
      terminalLines: [
        ["ok", "Project analysis complete"],
        ["plain", "Migration workflow created"],
        ["warn", "Secret values masked automatically"],
        ["plain", "Transfer steps queued"],
        ["plain", "Client report being prepared"],
        ["ok", "Live status sharing updated"],
        ["plain", "Verification scores generated"],
        ["ok", "Ready for handoff"]
      ],
      benefits: [
        "Zero data retention",
        "End-to-end encryption",
        "Live log tracking",
        "Zero downtime"
      ],
      closing: {
        title: "Ready to move?",
        lead: "Try the zero-risk migration platform today. No setup required.",
        cta: "Start free trial"
      },
      packagesTitle: "Pick the tool you need"
    },
    auth: {
      modeLabel: "Account action",
      registerTab: "Register",
      loginTab: "Sign in",
      registerTitle: "Create an account",
      registerDescription: "Enter your name and email and we will send a secure registration link.",
      loginTitle: "Sign in to the dashboard",
      loginDescription: "Enter your email and we will send a secure sign-in link.",
      name: "Full name",
      email: "Email",
      registerSubmit: "Send registration link",
      loginSubmit: "Send sign-in link",
      loading: "Signing in",
      error: "Could not start sign-in.",
      registerSuccessTitle: "Registration link sent",
      registerSuccessDescription: "Check your email to complete registration:",
      loginSuccessTitle: "Sign-in link sent",
      loginSuccessDescription: "Check your email to enter the dashboard:"
    },
    dashboard: {
      title: "Dashboard",
      description: "Current status for migration, install, and verification services.",
      newJob: "New service",
      monthUsage: "Used this month",
      running: "Running",
      completed: "Completed",
      failed: "Failed",
      servicesTitle: "Service packages",
      servicesDescription: "Standardize client work into repeatable service packages.",
      recentJobs: "Recent deliveries",
      recentDescription: "Open live progress and delivery details from here.",
      emptyTitle: "No deliveries yet",
      emptyDescription: "Once you start the first service, status, usage, and logs will appear here.",
      startJob: "Start service",
      sanitizedJob: "Protected delivery record"
    },
    newJob: {
      title: "New service",
      description: "Choose a package, enter temporary access details, and watch progress live."
    },
    launcher: {
      moduleTitle: "Service package",
      moduleDescription: "Choose the client service you want to deliver.",
      credits: "credits",
      secretNotice: "Root passwords, service-role keys, and database URLs are not stored; logs mask sensitive values.",
      sourceHost: "Source server",
      sourcePass: "Source root password",
      targetHost: "Target server",
      targetPass: "Target root password",
      targetInstance: "Supabase instance",
      cloudDbUrl: "Supabase Cloud database URL",
      cloudApiUrl: "Cloud API URL",
      cloudServiceKey: "Cloud service-role key",
      studioDomain: "Studio domain",
      apiDomain: "API domain",
      siteUrl: "Site URL",
      certbotEmail: "SSL email",
      schemaFilter: "Schema filter",
      settingsUpdates: "Settings changes",
      settingsPlaceholder: "SITE_URL=https://app.example.com\nDISABLE_SIGNUP=false",
      getSSL: "Issue SSL",
      setupBackup: "Move backups",
      migrateStorage: "Move storage",
      continueOnMinorErrors: "Continue on minor errors",
      skipInstall: "Skip install",
      submit: "Start service",
      loading: "Preparing",
      createError: "Could not create service."
    },
    job: {
      back: "Dashboard",
      id: "Delivery ID",
      retry: "Run again",
      retrying: "Preparing",
      credits: "credits",
      liveLog: "Live progress",
      waitingLog: "Waiting for logs...",
      summary: {
        runner: "Runner mode",
        source: "Source",
        target: "Target",
        instance: "Instance",
        scope: "Scope"
      }
    },
    settings: {
      title: "Plan and settings",
      description: "Workspace, usage limits, and security policy.",
      plan: "Plan",
      monthlyLimit: "Monthly service limit",
      parallelLimit: "Parallel services",
      usage: "Usage",
      billingTitle: "Billing adapter",
      billingDescription: "Plan and entitlement models are ready. A payment provider can be connected as a separate adapter.",
      billingTag: "Not connected",
      dbTitle: "Supabase database",
      dbDescription: "schema.sql includes workspace, membership, plan, delivery, and log tables.",
      dbTag: "Schema ready",
      credentialTitle: "Credential policy",
      credentialDescription: "Root passwords and service-role keys are not stored. Access details are required again for reruns.",
      credentialTag: "Secrets protected"
    },
    status: {
      queued: "Queued",
      running: "Running",
      success: "Completed",
      error: "Error",
      cancelled: "Cancelled"
    } satisfies Record<JobStatus, string>,
    misc: {
      demoWorkspace: "Demo workspace",
      owner: "owner",
      report: "Report",
      file: "File"
    }
  }
} as const;

export type AppCopy = typeof COPY.tr | typeof COPY.en;

export function getCopy(locale: Locale) {
  return COPY[locale];
}
