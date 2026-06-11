import type { JobStatus } from "@/types/domain";
import type { Locale } from "@/lib/preference-shared";

export const COPY = {
  tr: {
    brand: "Baseup",
    nav: {
      login: "Giriş",
      openPanel: "Paneli aç",
      dashboard: "Kontrol paneli",
      newJob: "Yeni işlem",
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
        ["plain", "İşlem raporu hazırlanıyor"],
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
      packagesTitle: "İhtiyacınıza uygun işlemi seçin"
    },
    auth: {
      modeLabel: "Hesap işlemi",
      registerTab: "Kayıt ol",
      loginTab: "Giriş yap",
      registerTitle: "Hesap oluştur",
      registerDescription: "Adınızı, e-posta adresinizi ve şifrenizi girerek hesabınızı oluşturun.",
      loginTitle: "Panele giriş",
      loginDescription: "E-posta adresiniz ve şifrenizle panele giriş yapın.",
      name: "Ad soyad",
      email: "E-posta",
      password: "Şifre",
      passwordConfirm: "Şifre tekrar",
      passwordMismatch: "Şifreler eşleşmiyor.",
      registerSubmit: "Hesap oluştur",
      loginSubmit: "Giriş yap",
      loading: "Giriş yapılıyor",
      error: "Giriş başlatılamadı.",
      registerSuccessTitle: "Hesap oluşturuldu",
      registerSuccessDescription: "Hesabınız hazır:",
      registerConfirmDescription: "E-posta doğrulaması açıksa hesabınızı tamamlamak için gelen kutunuzu kontrol edin:"
    },
    dashboard: {
      title: "Kontrol paneli",
      description: "Taşıma, kurulum ve doğrulama işlemlerinin güncel durumu.",
      newJob: "Yeni işlem",
      monthUsage: "Bu ay kullanılan",
      running: "Çalışan",
      completed: "Tamamlanan",
      failed: "Hatalı",
      servicesTitle: "İşlemler",
      servicesDescription: "Sık kullanılan taşıma, kurulum ve doğrulama işlemlerini buradan başlatın.",
      recentJobs: "Son teslimatlar",
      recentDescription: "Canlı ilerleme ve teslim detaylarına buradan ulaşılır.",
      emptyTitle: "Henüz teslimat yok",
      emptyDescription: "İlk işlemi başlattığınızda durum, kullanım ve log detayları burada görünür.",
      startJob: "İşlem başlat",
      sanitizedJob: "Güvenli teslimat kaydı"
    },
    newJob: {
      title: "Yeni işlem",
      description: "İşlemi seçin, geçici erişim bilgilerini girin ve ilerlemeyi canlı izleyin."
    },
    launcher: {
      stepperLabel: "İşlem başlatma adımları",
      stepPackage: "İşlem",
      stepDetails: "Bilgiler",
      stepOptions: "Seçenekler",
      moduleTitle: "İşlem",
      moduleDescription: "Yapmak istediğiniz işlemi seçin.",
      selectedPackage: "Seçilen işlem",
      reviewTitle: "Son kontrol",
      reviewDescription: "Başlatmadan önce ek seçenekleri seçin.",
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
      back: "Geri",
      next: "Devam et",
      submit: "İşlemi başlat",
      loading: "Hazırlanıyor",
      createError: "İşlem oluşturulamadı."
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
      description: "Planınızı, kullanım limitlerinizi ve ödeme ayarlarınızı yönetin.",
      plan: "Plan",
      monthlyLimit: "Aylık işlem limiti",
      parallelLimit: "Paralel işlem",
      usage: "Kullanım",
      teamTitle: "Ekip yönetimi",
      teamDescription: "Üyeleri ve rollerini yönetin.",
      teamTag: "Owner / Admin",
      billingTitle: "Plan ve ödeme",
      billingDescription: "Planınızı yükseltin, limitlerinizi ve ödeme seçeneklerinizi yönetin.",
      billingTag: "Faturalandırma",
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
      demoWorkspace: "Kişisel hesap",
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
      newJob: "New operation",
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
      packagesTitle: "Pick the operation you need"
    },
    auth: {
      modeLabel: "Account action",
      registerTab: "Register",
      loginTab: "Sign in",
      registerTitle: "Create an account",
      registerDescription: "Enter your name, email, and password to create your account.",
      loginTitle: "Sign in to the dashboard",
      loginDescription: "Sign in to the dashboard with your email and password.",
      name: "Full name",
      email: "Email",
      password: "Password",
      passwordConfirm: "Confirm password",
      passwordMismatch: "Passwords do not match.",
      registerSubmit: "Create account",
      loginSubmit: "Sign in",
      loading: "Signing in",
      error: "Could not start sign-in.",
      registerSuccessTitle: "Account created",
      registerSuccessDescription: "Your account is ready:",
      registerConfirmDescription: "If email confirmation is enabled, check your inbox to finish setup:"
    },
    dashboard: {
      title: "Dashboard",
      description: "Current status for migration, install, and verification operations.",
      newJob: "New operation",
      monthUsage: "Used this month",
      running: "Running",
      completed: "Completed",
      failed: "Failed",
      servicesTitle: "Operations",
      servicesDescription: "Start common migration, setup, and verification operations from here.",
      recentJobs: "Recent deliveries",
      recentDescription: "Open live progress and delivery details from here.",
      emptyTitle: "No deliveries yet",
      emptyDescription: "Once you start the first operation, status, usage, and logs will appear here.",
      startJob: "Start operation",
      sanitizedJob: "Protected delivery record"
    },
    newJob: {
      title: "New operation",
      description: "Choose an operation, enter temporary access details, and watch progress live."
    },
    launcher: {
      stepperLabel: "Operation launch steps",
      stepPackage: "Operation",
      stepDetails: "Details",
      stepOptions: "Options",
      moduleTitle: "Operation",
      moduleDescription: "Choose the operation you want to run.",
      selectedPackage: "Selected operation",
      reviewTitle: "Final check",
      reviewDescription: "Choose optional actions before starting the operation.",
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
      back: "Back",
      next: "Continue",
      submit: "Start operation",
      loading: "Preparing",
      createError: "Could not create operation."
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
      description: "Manage your plan, usage limits, and billing settings.",
      plan: "Plan",
      monthlyLimit: "Monthly operation limit",
      parallelLimit: "Parallel operations",
      usage: "Usage",
      teamTitle: "Team management",
      teamDescription: "Manage members and their roles.",
      teamTag: "Owner / Admin",
      billingTitle: "Plan and billing",
      billingDescription: "Upgrade your plan, limits, and payment options.",
      billingTag: "Billing",
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
      demoWorkspace: "Personal account",
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
