---
title: "PostgreSQL Logical Replication ile Sıfır Kesintili Supabase Taşıma"
date: "2026-06-12"
description: "Supabase projeleriniz için iki ana veritabanı taşıma yönteminin karşılaştırılması ve ne zaman kullanılacakları."
author: "Baseup SEO Team"
---

Veritabanı taşırken genellikle mantıksal döküm (`pg_dump`) veya mantıksal replikasyon (Logical Replication) arasında seçim yaparsınız.

## pg_dump: Standart Yöntem

`pg_dump` güvenilirdir ancak kesinti gerektirir.

## Mantıksal Replikasyon: Sıfır Kesinti

Replikasyon, verileri canlı olarak yayınlar. Kurulumu karmaşıktır ancak kesintiyi sıfıra indirir. Baseup, replikasyon sürecini yerleşik bir görsel arayüz ile yönetmenizi sağlar.
